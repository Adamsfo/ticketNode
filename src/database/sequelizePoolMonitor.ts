/**
 * Instrumentação temporária do pool Sequelize (sequelize-pool v6).
 *
 * Ativar: SEQUELIZE_POOL_MONITOR=true
 * Opcional: SEQUELIZE_POOL_MONITOR_LONG_HOLD_MS=5000
 *
 * Contexto: capturado de forma síncrona em sequelize.query / sequelize.transaction
 * e propagado via AsyncLocalStorage até pool.acquire (snapshot no momento da chamada).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Sequelize } from 'sequelize';

const INTERVAL_MS = 5000;
const DEFAULT_LONG_HOLD_MS = 5000;
const TOP_HOLDERS = 10;
const POOL_PATCHED = Symbol.for('jango.sequelizePoolMonitor.patched');
const API_PATCHED = Symbol.for('jango.sequelizePoolMonitor.apiPatched');

let started = false;
let poolPatchApplied = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

export type OperationKind =
    | 'query'
    | 'query-in-transaction'
    | 'transaction'
    | 'unknown';

export type PoolOperationContext = {
    stack: string;
    routine: string;
    inTransaction: boolean;
    kind: OperationKind;
};

export type AcquireContext = PoolOperationContext;

type HeldConnection = AcquireContext & {
    acquiredAt: number;
};

/** Propaga rotina/stack da operação Sequelize até a aquisição no pool. */
export const poolOperationContextAls =
    new AsyncLocalStorage<PoolOperationContext>();

const heldByResource = new Map<unknown, HeldConnection>();

type PoolLike = {
    size?: number;
    using?: number;
    available?: number;
    waiting?: number;
    maxSize?: number;
    acquire?: (...args: unknown[]) => Promise<unknown>;
    release?: (resource: unknown) => void;
    destroy?: (resource: unknown) => Promise<void> | void;
    read?: PoolLike;
    write?: PoolLike;
};

type ConnectionManagerLike = {
    pool?: PoolLike | null;
};

export function isSequelizePoolMonitorEnabled(): boolean {
    const raw = process.env.SEQUELIZE_POOL_MONITOR;
    if (raw == null || raw === '') return false;
    const v = String(raw).trim().toLowerCase();
    return v === 'true' || v === '1';
}

function longHoldThresholdMs(): number {
    const raw = process.env.SEQUELIZE_POOL_MONITOR_LONG_HOLD_MS;
    if (raw == null || raw === '') return DEFAULT_LONG_HOLD_MS;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_LONG_HOLD_MS;
}

function resolveSequelizePool(sequelize: Sequelize): PoolLike | null {
    const cm = sequelize.connectionManager as { pool?: PoolLike | null };
    const pool = cm?.pool;
    if (!pool || typeof pool !== 'object') {
        return null;
    }
    if (
        typeof pool.size !== 'number' ||
        typeof pool.using !== 'number' ||
        typeof pool.available !== 'number' ||
        typeof pool.waiting !== 'number'
    ) {
        return null;
    }
    return pool;
}

function resolveMax(pool: PoolLike, sequelize: Sequelize): number {
    if (typeof pool.maxSize === 'number' && pool.maxSize > 0) {
        return pool.maxSize;
    }
    const cfgMax = sequelize.config?.pool?.max;
    if (typeof cfgMax === 'number' && cfgMax > 0) {
        return cfgMax;
    }
    return 0;
}

const SKIP_STACK_PATTERNS = [
    'sequelizepoolmonitor',
    'node_modules\\sequelize',
    'node_modules/sequelize',
    'node_modules\\sequelize-pool',
    'node_modules/sequelize-pool',
    'node_modules/retry-as-promised',
    'node_modules\\retry-as-promised',
    'node:internal',
    'node:async_hooks',
    'node:internal/process/task_queues',
];

function isMonitorFrame(line: string): boolean {
    const lower = line.toLowerCase();
    if (lower.includes('sequelizepoolmonitor')) return true;
    if (lower.includes('querymonitored')) return true;
    if (lower.includes('transactionmonitored')) return true;
    if (lower.includes('buildoperationcontext')) return true;
    return false;
}

/** Código da aplicação (src ou dist em produção). Exclui node_modules. */
export function isAppStackLine(line: string): boolean {
    if (!line.includes('at ')) return false;
    const lower = line.toLowerCase();
    for (const skip of SKIP_STACK_PATTERNS) {
        if (lower.includes(skip)) return false;
    }
    if (lower.includes('node_modules')) return false;
    if (lower.includes('/dist/') || lower.includes('\\dist\\')) {
        return true;
    }
    if (lower.includes('/src/') || lower.includes('\\src\\')) {
        return true;
    }
    if (lower.includes('ticket-node') || lower.includes('jangoingressos')) {
        return true;
    }
    return false;
}

function routineFromLine(line: string): string | null {
    const fnMatch = line.match(/at (?:async )?([\w$.]+)/);
    if (fnMatch?.[1]) {
        const name = fnMatch[1];
        if (
            name !== 'Object.<anonymous>' &&
            name !== 'Module._compile' &&
            name !== 'processTicksAndRejections'
        ) {
            return name;
        }
    }

    const distPath = line.match(/[/\\]dist[/\\]([^):]+)/i);
    if (distPath?.[1]) {
        return distPath[1].replace(/\\/g, '/');
    }

    const srcPath = line.match(/[/\\]src[/\\]([^):]+)/i);
    if (srcPath?.[1]) {
        return srcPath[1].replace(/\\/g, '/');
    }

    return null;
}

/** Primeiro frame útil da aplicação no stack. */
export function inferRoutineFromStack(stack: string): string {
    const lines = stack.split('\n');
    for (const line of lines) {
        if (!isAppStackLine(line)) continue;
        const routine = routineFromLine(line);
        if (routine) return routine;
    }
    return '(sequelize-internal)';
}

export function summarizeStack(stack: string): string {
    const lines = stack.split('\n').slice(1);
    const picked: string[] = [];
    for (const line of lines) {
        if (picked.length >= 8) break;
        if (isMonitorFrame(line)) continue;
        if (isAppStackLine(line)) {
            picked.push(line.trim());
        }
    }
    if (picked.length === 0) {
        for (const line of lines) {
            if (picked.length >= 6) break;
            if (isMonitorFrame(line)) continue;
            const lower = line.toLowerCase();
            if (
                lower.includes('node_modules/sequelize') ||
                lower.includes('node_modules\\sequelize') ||
                lower.includes('retry-as-promised')
            ) {
                continue;
            }
            if (line.trim()) picked.push(line.trim());
        }
    }
    const joined = picked.join(' | ');
    return joined.length > 2000 ? joined.slice(0, 2000) + '…' : joined;
}

/** Stack capturado na entrada de query/transaction (antes de retry/getConnection). */
export function buildOperationContext(opts: {
    kind: OperationKind;
    inTransaction: boolean;
}): PoolOperationContext {
    const stackFull = new Error().stack ?? '';
    return {
        stack: summarizeStack(stackFull),
        routine: inferRoutineFromStack(stackFull),
        inTransaction: opts.inTransaction,
        kind: opts.kind,
    };
}

/** Fallback quando a aquisição não passou por query/transaction instrumentados. */
export function captureFallbackAcquireContext(): Pick<
    PoolOperationContext,
    'stack' | 'routine'
> {
    const stackFull = new Error().stack ?? '';
    return {
        stack: summarizeStack(stackFull),
        routine: inferRoutineFromStack(stackFull),
    };
}

/**
 * Contexto associado a uma conexão no pool.acquire (snapshot síncrono).
 * Usado pelos testes de concorrência.
 */
export function snapshotContextForPoolAcquire(): AcquireContext {
    const store = poolOperationContextAls.getStore();
    if (store) {
        return store;
    }
    const fb = captureFallbackAcquireContext();
    return {
        ...fb,
        inTransaction: false,
        kind: 'unknown',
    };
}

function registerHeld(resource: unknown, ctx: AcquireContext): void {
    heldByResource.set(resource, {
        acquiredAt: Date.now(),
        stack: ctx.stack,
        routine: ctx.routine,
        inTransaction: ctx.inTransaction,
        kind: ctx.kind,
    });
}

function unregisterHeld(resource: unknown): void {
    heldByResource.delete(resource);
}

function contextLabel(kind: OperationKind, inTransaction: boolean): string {
    if (kind === 'transaction') return 'transaction';
    if (inTransaction || kind === 'query-in-transaction') return 'transaction';
    if (kind === 'query') return 'query';
    return 'unknown';
}

function instrumentSequelizeApi(sequelize: Sequelize): void {
    const s = sequelize as Sequelize & Record<symbol, boolean>;
    if (s[API_PATCHED]) {
        return;
    }

    type SequelizeQuery = Sequelize['query'];
    type SequelizeTransaction = Sequelize['transaction'];

    const originalQuery = sequelize.query.bind(sequelize) as SequelizeQuery;
    const queryMonitored = function (
        sql: Parameters<SequelizeQuery>[0],
        options?: Parameters<SequelizeQuery>[1]
    ): ReturnType<SequelizeQuery> {
        const opts = (options ?? {}) as { transaction?: unknown };
        const inTx = Boolean(opts.transaction);
        const ctx = buildOperationContext({
            kind: inTx ? 'query-in-transaction' : 'query',
            inTransaction: inTx,
        });
        return poolOperationContextAls.run(ctx, () =>
            originalQuery(sql, options)
        );
    };
    sequelize.query = queryMonitored as SequelizeQuery;

    const originalTransaction = sequelize.transaction.bind(sequelize);
    sequelize.transaction = function transactionMonitored(
        ...args: unknown[]
    ) {
        const ctx = buildOperationContext({
            kind: 'transaction',
            inTransaction: true,
        });
        return poolOperationContextAls.run(ctx, () =>
            (originalTransaction as (...a: unknown[]) => unknown)(...args)
        );
    } as SequelizeTransaction;

    s[API_PATCHED] = true;
}

function instrumentSequelizePool(pool: PoolLike): void {
    const poolAny = pool as Record<symbol, boolean>;
    if (poolAny[POOL_PATCHED]) {
        return;
    }
    if (
        typeof pool.acquire !== 'function' ||
        typeof pool.release !== 'function'
    ) {
        return;
    }

    const originalAcquire = pool.acquire.bind(pool);
    const originalRelease = pool.release.bind(pool);
    const originalDestroy =
        typeof pool.destroy === 'function'
            ? pool.destroy.bind(pool)
            : null;

    pool.acquire = (...args: unknown[]) => {
        const ctx = snapshotContextForPoolAcquire();
        return originalAcquire(...args).then((resource: unknown) => {
            if (resource != null) {
                registerHeld(resource, ctx);
            }
            return resource;
        });
    };

    pool.release = (resource: unknown) => {
        unregisterHeld(resource);
        return originalRelease(resource);
    };

    if (originalDestroy) {
        pool.destroy = (resource: unknown) => {
            unregisterHeld(resource);
            return originalDestroy(resource);
        };
    }

    poolAny[POOL_PATCHED] = true;
}

function tryInstrumentSequelize(sequelize: Sequelize): void {
    instrumentSequelizeApi(sequelize);

    if (poolPatchApplied) {
        return;
    }
    const cm = sequelize.connectionManager as ConnectionManagerLike;
    const pool = cm?.pool;
    if (!pool) {
        return;
    }

    if (pool.read && pool.write) {
        instrumentSequelizePool(pool.read);
        instrumentSequelizePool(pool.write);
        poolPatchApplied = true;
        return;
    }

    if (typeof pool.acquire === 'function') {
        instrumentSequelizePool(pool);
        poolPatchApplied = true;
    }
}

function logHeldConnectionsReport(): void {
    const now = Date.now();
    const longMs = longHoldThresholdMs();
    const ranked = [...heldByResource.entries()]
        .map(([, info]) => ({
            durationMs: now - info.acquiredAt,
            routine: info.routine,
            stack: info.stack,
            inTransaction: info.inTransaction,
            context: contextLabel(info.kind, info.inTransaction),
        }))
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, TOP_HOLDERS);

    if (ranked.length === 0) {
        process.stdout.write(
            'LONGEST HELD CONNECTIONS: (tracking vazio — nenhuma conexão em uso rastreada)\n'
        );
        return;
    }

    process.stdout.write('LONGEST HELD CONNECTIONS:\n');
    ranked.forEach((row, index) => {
        const sec = (row.durationMs / 1000).toFixed(1);
        const longTag = row.durationMs >= longMs ? ' [LONG]' : '';
        process.stdout.write(
            `#${index + 1} duration=${sec}s${longTag}\n`
        );
        process.stdout.write(`routine=${row.routine}\n`);
        process.stdout.write(
            `transaction=${row.inTransaction ? 'true' : 'false'}\n`
        );
        process.stdout.write(`context=${row.context}\n`);
        process.stdout.write(`stack=${row.stack}\n`);
    });
}

function logPoolLine(sequelize: Sequelize): void {
    tryInstrumentSequelize(sequelize);

    const pool = resolveSequelizePool(sequelize);
    if (!pool) {
        return;
    }

    const size = pool.size!;
    const using = pool.using!;
    const available = pool.available!;
    const waiting = pool.waiting!;
    const max = resolveMax(pool, sequelize);

    const saturated = waiting > 0 || (max > 0 && using >= max);
    const prefix = saturated
        ? '[SEQUELIZE_POOL][SATURATED]'
        : '[SEQUELIZE_POOL]';
    const ts = new Date().toISOString();

    const line = `${prefix} ts=${ts} pid=${process.pid} size=${size} using=${using} available=${available} waiting=${waiting} max=${max} tracked=${heldByResource.size}`;

    process.stdout.write(`${line}\n`);

    if (saturated) {
        logHeldConnectionsReport();
    }
}

export function startSequelizePoolMonitor(sequelize: Sequelize): void {
    if (!isSequelizePoolMonitorEnabled()) {
        return;
    }
    if (started) {
        return;
    }
    started = true;

    tryInstrumentSequelize(sequelize);

    const tick = () => {
        try {
            logPoolLine(sequelize);
        } catch {
            // Instrumentação: não derrubar o processo.
        }
    };

    tick();
    intervalHandle = setInterval(tick, INTERVAL_MS);
    if (typeof intervalHandle.unref === 'function') {
        intervalHandle.unref();
    }
}

export function stopSequelizePoolMonitor(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
    heldByResource.clear();
    started = false;
    poolPatchApplied = false;
}
