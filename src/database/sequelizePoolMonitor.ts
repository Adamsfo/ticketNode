/**
 * Instrumentação temporária do pool Sequelize (sequelize-pool v6).
 *
 * Ativar: SEQUELIZE_POOL_MONITOR=true
 * Opcional: SEQUELIZE_POOL_MONITOR_LONG_HOLD_MS=5000
 *
 * Contexto de aquisição: stack capturado em connectionManager.getConnection()
 * (antes do pool.acquire), associado ao resource no pool.acquire via fila FIFO.
 */
import type { Sequelize } from 'sequelize';

const INTERVAL_MS = 5000;
const DEFAULT_LONG_HOLD_MS = 5000;
const TOP_HOLDERS = 10;
const POOL_PATCHED = Symbol.for('jango.sequelizePoolMonitor.patched');
const CM_PATCHED = Symbol.for('jango.sequelizePoolMonitor.cmPatched');

let started = false;
let poolPatchApplied = false;
let cmPatchApplied = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

type AcquireContext = {
    stack: string;
    routine: string;
};

type HeldConnection = AcquireContext & {
    acquiredAt: number;
};

const heldByResource = new Map<unknown, HeldConnection>();

/** Contextos empilhados em getConnection; consumidos no pool.acquire (FIFO). */
const pendingGetConnectionContexts: AcquireContext[] = [];

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
    getConnection: (options?: unknown) => Promise<unknown>;
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
    'node:internal',
    'node:async_hooks',
    'node:internal/process/task_queues',
];

function isMonitorFrame(line: string): boolean {
    return line.toLowerCase().includes('sequelizepoolmonitor');
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

/** Primeiro frame útil da aplicação no stack de getConnection. */
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
                lower.includes('node_modules\\sequelize')
            ) {
                continue;
            }
            if (line.trim()) picked.push(line.trim());
        }
    }
    const joined = picked.join(' | ');
    return joined.length > 2000 ? joined.slice(0, 2000) + '…' : joined;
}

/** Stack da cadeia que chamou getConnection (não do pool.acquire interno). */
export function captureGetConnectionContext(): AcquireContext {
    const stackFull = new Error().stack ?? '';
    return {
        stack: summarizeStack(stackFull),
        routine: inferRoutineFromStack(stackFull),
    };
}

function takeAcquireContext(): AcquireContext {
    const pending = pendingGetConnectionContexts.shift();
    if (pending) {
        return pending;
    }
    return captureGetConnectionContext();
}

function registerHeld(resource: unknown, ctx: AcquireContext): void {
    heldByResource.set(resource, {
        acquiredAt: Date.now(),
        stack: ctx.stack,
        routine: ctx.routine,
    });
}

function unregisterHeld(resource: unknown): void {
    heldByResource.delete(resource);
}

function instrumentConnectionManager(sequelize: Sequelize): void {
    const cm = sequelize.connectionManager as unknown as ConnectionManagerLike &
        Record<symbol, boolean>;
    if (cm[CM_PATCHED]) {
        return;
    }
    if (typeof cm.getConnection !== 'function') {
        return;
    }

    const originalGetConnection = cm.getConnection.bind(cm);

    cm.getConnection = async function getConnectionMonitored(
        options?: unknown
    ) {
        pendingGetConnectionContexts.push(captureGetConnectionContext());
        try {
            return await originalGetConnection(options);
        } catch (err) {
            if (pendingGetConnectionContexts.length > 0) {
                pendingGetConnectionContexts.pop();
            }
            throw err;
        }
    };

    cm[CM_PATCHED] = true;
    cmPatchApplied = true;
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
        const ctx = takeAcquireContext();
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
    instrumentConnectionManager(sequelize);

    if (poolPatchApplied) {
        return;
    }
    const cm = sequelize.connectionManager as { pool?: PoolLike | null };
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
    pendingGetConnectionContexts.length = 0;
    started = false;
    poolPatchApplied = false;
    cmPatchApplied = false;
}
