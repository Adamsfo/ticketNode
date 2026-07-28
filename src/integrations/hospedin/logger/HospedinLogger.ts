/**
 * Logger exclusivo da integração Hospedin.
 * Desacoplado do módulo Hospedagem — apenas console estruturado.
 *
 * Corpo de resposta só é emitido com HOSPEDIN_DEBUG=true|1.
 */

import { getHospedinConfig } from '../constants/config';

export type HospedinLogLevel = 'debug' | 'info' | 'warn' | 'error';

export type HospedinRequestLogStart = {
    method: string;
    endpoint: string;
    params?: Record<string, unknown> | null;
};

export type HospedinRequestLogEnd = {
    method: string;
    endpoint: string;
    status: number;
    durationMs: number;
    errorMessage?: string;
    responseBody?: unknown;
};

function isDebugEnabled(): boolean {
    return getHospedinConfig().debug;
}

function ts(): string {
    return new Date().toISOString();
}

function write(
    level: HospedinLogLevel,
    message: string,
    meta?: Record<string, unknown>
): void {
    if (level === 'debug' && !isDebugEnabled()) return;

    const payload = {
        ts: ts(),
        scope: 'Hospedin',
        level,
        message,
        ...(meta && Object.keys(meta).length ? { meta } : {}),
    };

    const line = `[Hospedin] ${JSON.stringify(payload)}`;

    switch (level) {
        case 'error':
            console.error(line);
            break;
        case 'warn':
            console.warn(line);
            break;
        case 'debug':
            console.debug(line);
            break;
        default:
            console.log(line);
    }
}

export const HospedinLogger = {
    isDebugEnabled,

    debug(message: string, meta?: Record<string, unknown>): void {
        write('debug', message, meta);
    },

    info(message: string, meta?: Record<string, unknown>): void {
        write('info', message, meta);
    },

    warn(message: string, meta?: Record<string, unknown>): void {
        write('warn', message, meta);
    },

    error(message: string, meta?: Record<string, unknown>): void {
        write('error', message, meta);
    },

    auth(message: string, meta?: Record<string, unknown>): void {
        write('info', `auth: ${message}`, meta);
    },

    requestStart(data: HospedinRequestLogStart): void {
        write('info', 'request:start', {
            method: data.method.toUpperCase(),
            endpoint: data.endpoint,
            ...(data.params ? { params: data.params } : {}),
        });
    },

    requestEnd(data: HospedinRequestLogEnd): void {
        const level: HospedinLogLevel =
            data.status >= 500 ? 'error' : data.status >= 400 ? 'warn' : 'info';

        const meta: Record<string, unknown> = {
            method: data.method.toUpperCase(),
            endpoint: data.endpoint,
            status: data.status,
            durationMs: data.durationMs,
        };

        if (data.errorMessage) {
            meta.error = data.errorMessage;
        }

        if (isDebugEnabled() && data.responseBody !== undefined) {
            meta.responseBody = data.responseBody;
        }

        write(level, 'request:end', meta);
    },
};
