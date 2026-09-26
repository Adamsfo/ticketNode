/**
 * Instrumentação temporária do pool Sequelize (sequelize-pool v6).
 *
 * Ativar: SEQUELIZE_POOL_MONITOR=true
 * Opcional: SEQUELIZE_POOL_MONITOR_LONG_HOLD_MS=5000 (destaque [LONG] no relatório saturado)
 *
 * Métricas: getters oficiais size, using, available, waiting, maxSize.
 * Em saturação: top 10 conexões mais tempo em uso (stack capturado no acquire do pool).
 *
 * Monkey patch único em pool.acquire / pool.release / pool.destroy (sem queries extras).
 */
import type { Sequelize } from 'sequelize';

const INTERVAL_MS = 5000;
const DEFAULT_LONG_HOLD_MS = 5000;
const TOP_HOLDERS = 10;
const PATCHED = Symbol.for('jango.sequelizePoolMonitor.patched');

let started = false;
let patchApplied = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

type HeldConnection = {
    acquiredAt: number;
    stack: string;
    routine: string;
};

/** Recursos atualmente em uso (chave = objeto connection do mysql2). Máx. ~pool.max. */
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
    'sequelizePoolMonitor',
    'node_modules\\sequelize',
    'node_modules/sequelize',
    'node_modules\\sequelize-pool',
    'node_modules/sequelize-pool',
    'node:internal',
    'node:async_hooks',
];

function isAppStackLine(line: string): boolean {
    if (!line.includes('at ')) return false;
    const lower = line.toLowerCase();
    for (const skip of SKIP_STACK_PATTERNS) {
        if (lower.includes(skip.toLowerCase())) return false;
    }
    return (
        lower.includes('ticket-node') ||
        lower.includes('jangoingressos') ||
        lower.includes('\\src\\') ||
        lower.includes('/src/')
    );
}

/** Extrai identificador legível do primeiro frame da aplicação no stack do acquire. */
export function inferRoutineFromStack(stack: string): string {
    const lines = stack.split('\n');
    for (const line of lines) {
        if (!isAppStackLine(line)) continue;

        const fnMatch = line.match(/at (?:async )?([^\s(]+)/);
        if (fnMatch?.[1]) {
            const name = fnMatch[1];
            if (name !== 'Object.<anonymous>' && name !== 'Module._compile') {
                return name;
            }
        }

        const pathMatch = line.match(/(?:ticket-node[/\\]src[/\\][^:)]+)/i);
        if (pathMatch?.[0]) {
            return pathMatch[0].replace(/\\/g, '/');
        }
    }
    return '(sequelize-internal)';
}

function summarizeStack(stack: string): string {
    const lines = stack.split('\n').slice(1);
    const picked: string[] = [];
    for (const line of lines) {
        if (picked.length >= 8) break;
        if (isAppStackLine(line) || picked.length === 0) {
            picked.push(line.trim());
        }
    }
    if (picked.length === 0) {
        return lines.slice(0, 4).map((l) => l.trim()).join(' | ');
    }
    const joined = picked.join(' | ');
    return joined.length > 2000 ? joined.slice(0, 2000) + '…' : joined;
}

function captureAcquireContext(): Omit<HeldConnection, 'acquiredAt'> & {
    stackFull: string;
} {
    const stackFull = new Error().stack ?? '';
    return {
        stack: summarizeStack(stackFull),
        routine: inferRoutineFromStack(stackFull),
        stackFull,
    };
}

function registerHeld(
    resource: unknown,
    ctx: ReturnType<typeof captureAcquireContext>
): void {
    heldByResource.set(resource, {
        acquiredAt: Date.now(),
        stack: ctx.stack,
        routine: ctx.routine,
    });
}

function unregisterHeld(resource: unknown): void {
    heldByResource.delete(resource);
}

/**
 * Envolve acquire/release/destroy do sequelize-pool (API real v6).
 * Marcador PATCHED evita wrapper em cadeia.
 */
function instrumentSequelizePool(pool: PoolLike): void {
    const poolAny = pool as Record<symbol, boolean>;
    if (poolAny[PATCHED]) {
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
        const ctx = captureAcquireContext();
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

    poolAny[PATCHED] = true;
}

function tryInstrumentPools(sequelize: Sequelize): void {
    if (patchApplied) {
        return;
    }
    const cm = sequelize.connectionManager as { pool?: PoolLike | null };
    const pool = cm?.pool;
    if (!pool) {
        return;
    }

    // Replicação: dois pools sequelize-pool (read/write).
    if (pool.read && pool.write) {
        instrumentSequelizePool(pool.read);
        instrumentSequelizePool(pool.write);
        patchApplied = true;
        return;
    }

    if (typeof pool.acquire === 'function') {
        instrumentSequelizePool(pool);
        patchApplied = true;
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
            'LONGEST HELD CONNECTIONS: (tracking vazio — acquire ainda não instrumentado ou todas liberadas)\n'
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
    tryInstrumentPools(sequelize);

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

    // Patch imediato (pool já existe após authenticate) — não esperar o primeiro tick.
    tryInstrumentPools(sequelize);

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
    patchApplied = false;
}
