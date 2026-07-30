/**
 * Logger central do ticket-node.
 *
 * Níveis: ERROR | WARN | INFO | DEBUG
 * ENV:
 *   LOG_LEVEL=INFO|WARN|ERROR|DEBUG  (padrão INFO)
 *   LOG_SQL=true|false               (padrão false — Sequelize)
 *   LOG_HTTP=true|false              (padrão false)
 *   LOG_PAYLOAD=true|false           (padrão false)
 */

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

const LEVEL_RANK: Record<LogLevel, number> = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
};

function parseLevel(raw?: string | null): LogLevel {
    const v = String(raw || 'INFO').trim().toUpperCase();
    if (v === 'ERROR' || v === 'WARN' || v === 'INFO' || v === 'DEBUG') {
        return v;
    }
    if (v === 'WARNING') return 'WARN';
    return 'INFO';
}

function envFlag(name: string, defaultValue = false): boolean {
    const v = String(process.env[name] ?? '')
        .trim()
        .toLowerCase();
    if (!v) return defaultValue;
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

let currentLevel: LogLevel = parseLevel(process.env.LOG_LEVEL);

export function getLogLevel(): LogLevel {
    return currentLevel;
}

export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

export function isLogEnabled(level: LogLevel): boolean {
    return LEVEL_RANK[level] <= LEVEL_RANK[currentLevel];
}

export function isSqlLogEnabled(): boolean {
    return envFlag('LOG_SQL', false);
}

export function isHttpLogEnabled(): boolean {
    return envFlag('LOG_HTTP', false) || isLogEnabled('DEBUG');
}

export function isPayloadLogEnabled(): boolean {
    return envFlag('LOG_PAYLOAD', false) || isLogEnabled('DEBUG');
}

function ts(): string {
    return new Date().toISOString();
}

function formatMeta(meta?: unknown): string {
    if (meta === undefined || meta === null) return '';
    if (typeof meta === 'string') return ` ${meta}`;
    try {
        return ` ${JSON.stringify(meta)}`;
    } catch {
        return ` ${String(meta)}`;
    }
}

function write(
    level: LogLevel,
    message: string,
    meta?: unknown,
    scope?: string
): void {
    if (!isLogEnabled(level)) return;

    const prefix = scope ? `[${level}][${scope}]` : `[${level}]`;
    const line = `${prefix} ${message}${formatMeta(meta)}`;

    switch (level) {
        case 'ERROR':
            // eslint-disable-next-line no-console
            console.error(line);
            break;
        case 'WARN':
            // eslint-disable-next-line no-console
            console.warn(line);
            break;
        case 'DEBUG':
            // eslint-disable-next-line no-console
            console.debug(line);
            break;
        default:
            // eslint-disable-next-line no-console
            console.info(line);
    }
}

export type Logger = {
    error: (message: string, meta?: unknown) => void;
    warn: (message: string, meta?: unknown) => void;
    info: (message: string, meta?: unknown) => void;
    debug: (message: string, meta?: unknown) => void;
    child: (scope: string) => Logger;
};

function createLogger(scope?: string): Logger {
    return {
        error(message, meta) {
            write('ERROR', message, meta, scope);
        },
        warn(message, meta) {
            write('WARN', message, meta, scope);
        },
        info(message, meta) {
            write('INFO', message, meta, scope);
        },
        debug(message, meta) {
            write('DEBUG', message, meta, scope);
        },
        child(childScope) {
            return createLogger(
                scope ? `${scope}:${childScope}` : childScope
            );
        },
    };
}

export const logger = createLogger();

/**
 * Erro operacional formatado (provider / reserva / etapa).
 */
export function logOperationalError(input: {
    provider?: string;
    reservationId?: string | number | null;
    stage?: string;
    message: string;
    stack?: string | null;
    meta?: Record<string, unknown>;
}): void {
    if (!isLogEnabled('ERROR')) return;
    const lines = [
        '[ERROR]',
        input.provider ? `Provider: ${input.provider}` : null,
        input.reservationId != null
            ? `Reserva: ${input.reservationId}`
            : null,
        input.stage ? `Etapa: ${input.stage}` : null,
        'Mensagem:',
        input.message,
        input.stack ? `Stack:\n${input.stack}` : null,
    ].filter(Boolean);
    // eslint-disable-next-line no-console
    console.error(lines.join('\n'));
    if (input.meta && isLogEnabled('DEBUG')) {
        // eslint-disable-next-line no-console
        console.error('[ERROR][meta]', formatMeta(input.meta));
    }
}

/**
 * Resumo único de ciclo do scheduler (INFO).
 */
export function logSchedulerSummary(input: {
    provider: string;
    imported?: number;
    validated?: number;
    created?: number;
    updated?: number;
    cancelled?: number;
    ignored?: number;
    failed?: number;
    durationMs?: number | null;
    status?: string;
}): void {
    if (!isLogEnabled('INFO')) return;
    const tempoSec = Math.round(Number(input.durationMs || 0) / 1000);
    const block = [
        '[Scheduler]',
        input.provider,
        '',
        `Importadas: ${input.imported ?? 0}`,
        `Validadas: ${input.validated ?? 0}`,
        `CREATE: ${input.created ?? 0}`,
        `UPDATE: ${input.updated ?? 0}`,
        `CANCEL: ${input.cancelled ?? 0}`,
        `Ignoradas: ${input.ignored ?? 0}`,
        `Falhas: ${input.failed ?? 0}`,
        '',
        `Tempo: ${tempoSec}s`,
        input.status ? `Status: ${input.status}` : null,
    ]
        .filter((l) => l !== null)
        .join('\n');
    // eslint-disable-next-line no-console
    console.info(block);
}

/** Callback Sequelize: só emite SQL se LOG_SQL=true. */
export function sequelizeLogging(
    sql: string,
    timing?: number
): void {
    if (!isSqlLogEnabled()) return;
    write(
        'DEBUG',
        timing != null ? `${sql} (${timing}ms)` : sql,
        undefined,
        'SQL'
    );
}

export { parseLevel as parseLogLevel, ts as logTimestamp };
