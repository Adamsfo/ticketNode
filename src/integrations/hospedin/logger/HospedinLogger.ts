/**
 * Logger da integração Hospedin — delega ao logger central.
 *
 * Por padrão (LOG_LEVEL=INFO): apenas WARN/ERROR.
 * Detalhes de request/payload/regra por reserva → DEBUG.
 */

import {
    isHttpLogEnabled,
    isPayloadLogEnabled,
    logOperationalError,
    logger,
} from '../../../utils/logger';

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

const log = logger.child('Hospedin');

export function isDebugEnabled(): boolean {
    return isPayloadLogEnabled() || isHttpLogEnabled();
}

export const HospedinLogger = {
    isDebugEnabled,

    debug(message: string, meta?: Record<string, unknown>): void {
        log.debug(message, meta);
    },

    /** Eventos verbosos da integração → DEBUG (não poluem INFO). */
    info(message: string, meta?: Record<string, unknown>): void {
        log.debug(message, meta);
    },

    warn(message: string, meta?: Record<string, unknown>): void {
        log.warn(message, meta);
    },

    error(message: string, meta?: Record<string, unknown>): void {
        const reservationId =
            meta?.reservation_id ??
            meta?.reservationId ??
            meta?.external_id ??
            null;
        const stage =
            typeof meta?.stage === 'string'
                ? meta.stage
                : typeof meta?.action === 'string'
                  ? String(meta.action)
                  : undefined;
        if (reservationId != null || stage) {
            logOperationalError({
                provider: 'Hospedin',
                reservationId: reservationId as string | number | null,
                stage,
                message,
                stack:
                    typeof meta?.stack === 'string' ? meta.stack : null,
                meta,
            });
            return;
        }
        log.error(message, meta);
    },

    auth(message: string, meta?: Record<string, unknown>): void {
        log.debug(`auth: ${message}`, meta);
    },

    requestStart(data: HospedinRequestLogStart): void {
        if (!isHttpLogEnabled()) return;
        log.debug('request:start', {
            method: data.method.toUpperCase(),
            endpoint: data.endpoint,
            ...(data.params ? { params: data.params } : {}),
        });
    },

    requestEnd(data: HospedinRequestLogEnd): void {
        if (data.status >= 500) {
            log.error('request:end', {
                method: data.method.toUpperCase(),
                endpoint: data.endpoint,
                status: data.status,
                durationMs: data.durationMs,
                error: data.errorMessage,
            });
            return;
        }
        if (data.status >= 400) {
            log.warn('request:end', {
                method: data.method.toUpperCase(),
                endpoint: data.endpoint,
                status: data.status,
                durationMs: data.durationMs,
                error: data.errorMessage,
            });
            return;
        }
        if (!isHttpLogEnabled()) return;
        const meta: Record<string, unknown> = {
            method: data.method.toUpperCase(),
            endpoint: data.endpoint,
            status: data.status,
            durationMs: data.durationMs,
        };
        if (isPayloadLogEnabled() && data.responseBody !== undefined) {
            meta.responseBody = data.responseBody;
        }
        log.debug('request:end', meta);
    },
};
