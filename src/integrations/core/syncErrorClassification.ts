/**
 * Classificação de erros de sincronização (genérico multi-provider).
 */

export const SyncErrorCode = {
    ROOM_MAPPING_NOT_FOUND: 'ROOM_MAPPING_NOT_FOUND',
    WAIT_MAPPING: 'WAIT_MAPPING',
    SUITE_IGNORED: 'SUITE_IGNORED',
    RESERVATION_IN_PAST: 'RESERVATION_IN_PAST',
    INVALID_GUEST: 'INVALID_GUEST',
    INVALID_DOCUMENT: 'INVALID_DOCUMENT',
    INVALID_DATES: 'INVALID_DATES',
    ORIGIN_CONFLICT: 'ORIGIN_CONFLICT',
    PAYLOAD_INCOMPLETE: 'PAYLOAD_INCOMPLETE',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
    TIMEOUT: 'TIMEOUT',
    PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
    RUNNER_ERROR: 'RUNNER_ERROR',
    EXECUTOR_ERROR: 'EXECUTOR_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type SyncErrorCodeValue =
    (typeof SyncErrorCode)[keyof typeof SyncErrorCode];

/** Severidade operacional. */
export const SyncErrorSeverity = {
    CRITICAL: 'CRITICAL',
    ALERT: 'ALERT',
    INFO: 'INFO',
} as const;

export type SyncErrorSeverityValue =
    (typeof SyncErrorSeverity)[keyof typeof SyncErrorSeverity];

/** Resolução da pendência operacional (não apaga histórico). */
export const SyncResolutionStatus = {
    OPEN: 'OPEN',
    RESOLVED: 'RESOLVED',
    IGNORED: 'IGNORED',
} as const;

export type SyncResolutionStatusValue =
    (typeof SyncResolutionStatus)[keyof typeof SyncResolutionStatus];

/**
 * Erros permanentes / sem ação operacional.
 * Após classificados, saem da tela de Pendências (resolution=IGNORED).
 */
const PERMANENT_NON_ACTIONABLE = new Set<string>([
    SyncErrorCode.RESERVATION_IN_PAST,
    SyncErrorCode.INVALID_DATES,
    SyncErrorCode.SUITE_IGNORED,
]);

export function isPermanentNonActionableError(
    code?: string | null,
    message?: string | null
): boolean {
    const normalized = normalizeSyncErrorCode(code, message);
    if (PERMANENT_NON_ACTIONABLE.has(normalized)) return true;
    const msg = String(message || '').toLowerCase();
    if (msg.includes('datas passadas')) return true;
    if (msg.includes('não é permitido criar reservas para datas passadas')) {
        return true;
    }
    if (msg.includes('check-in') && msg.includes('passad')) return true;
    if (msg.includes('ignorada por configuração')) return true;
    return false;
}

export function resolutionForFailure(input: {
    code?: string | null;
    message?: string | null;
}): SyncResolutionStatusValue {
    if (isPermanentNonActionableError(input.code, input.message)) {
        return SyncResolutionStatus.IGNORED;
    }
    return SyncResolutionStatus.OPEN;
}
const CODE_SEVERITY: Record<string, SyncErrorSeverityValue> = {
    ROOM_MAPPING_NOT_FOUND: SyncErrorSeverity.CRITICAL,
    ORIGIN_CONFLICT: SyncErrorSeverity.CRITICAL,
    // Permanentes / sem ação — INFO (saem da pendência via IGNORED)
    RESERVATION_IN_PAST: SyncErrorSeverity.INFO,
    INVALID_DATES: SyncErrorSeverity.INFO,
    INVALID_GUEST: SyncErrorSeverity.CRITICAL,
    INVALID_DOCUMENT: SyncErrorSeverity.CRITICAL,
    PAYLOAD_INCOMPLETE: SyncErrorSeverity.CRITICAL,
    VALIDATION_ERROR: SyncErrorSeverity.CRITICAL,
    EXECUTOR_ERROR: SyncErrorSeverity.CRITICAL,
    WAIT_MAPPING: SyncErrorSeverity.ALERT,
    SUITE_IGNORED: SyncErrorSeverity.INFO,
    RUNNER_ERROR: SyncErrorSeverity.ALERT,
    NETWORK_ERROR: SyncErrorSeverity.ALERT,
    TIMEOUT: SyncErrorSeverity.ALERT,
    PROVIDER_UNAVAILABLE: SyncErrorSeverity.ALERT,
    UNKNOWN_ERROR: SyncErrorSeverity.ALERT,
};

/** Falhas temporárias — elegíveis a retry inteligente (30s → 1min → 2min). */
const TRANSIENT_CODES = new Set<string>([
    SyncErrorCode.NETWORK_ERROR,
    SyncErrorCode.TIMEOUT,
    SyncErrorCode.PROVIDER_UNAVAILABLE,
]);

/** Backoff curto para retry inteligente (ms). */
export const SMART_RETRY_BACKOFF_MS = [30_000, 60_000, 120_000] as const;

export function severityForErrorCode(
    code?: string | null
): SyncErrorSeverityValue {
    if (!code) return SyncErrorSeverity.ALERT;
    return CODE_SEVERITY[String(code).toUpperCase()] || SyncErrorSeverity.ALERT;
}

export function isTransientErrorCode(code?: string | null): boolean {
    if (!code) return false;
    return TRANSIENT_CODES.has(String(code).toUpperCase());
}

export function computeSmartRetryAt(
    retryCount: number,
    from = Date.now()
): Date | null {
    const idx = Math.min(
        Math.max(0, retryCount),
        SMART_RETRY_BACKOFF_MS.length - 1
    );
    // Após esgotar as 3 janelas curtas, não agenda smart retry (volta ao ciclo do scheduler).
    if (retryCount >= SMART_RETRY_BACKOFF_MS.length) return null;
    return new Date(from + SMART_RETRY_BACKOFF_MS[idx]);
}

/**
 * Normaliza códigos vindos do pipeline Hospedin / genéricos.
 */
export function normalizeSyncErrorCode(
    raw?: string | null,
    message?: string | null
): SyncErrorCodeValue {
    const code = String(raw || '').toUpperCase();
    const msg = String(message || '').toLowerCase();

    if (code === 'WAIT_MAPPING' || msg.includes('mapeamento') || msg.includes('mapping')) {
        if (code === 'SUITE_IGNORED' || msg.includes('ignorada por configuração')) {
            return SyncErrorCode.SUITE_IGNORED;
        }
        if (code === 'WAIT_MAPPING' || msg.includes('aguardando')) {
            return SyncErrorCode.WAIT_MAPPING;
        }
        return SyncErrorCode.ROOM_MAPPING_NOT_FOUND;
    }
    if (code === 'SUITE_IGNORED' || msg.includes('ignorada por configuração')) {
        return SyncErrorCode.SUITE_IGNORED;
    }
    if (code === 'ORIGIN_CONFLICT') return SyncErrorCode.ORIGIN_CONFLICT;
    if (code === 'PAYLOAD_INCOMPLETE') return SyncErrorCode.PAYLOAD_INCOMPLETE;
    if (code === 'INVALID_DATES' || msg.includes('datas passadas') || msg.includes('in_past')) {
        return SyncErrorCode.RESERVATION_IN_PAST;
    }
    if (code === 'INVALID_GUEST' || msg.includes('hóspede') || msg.includes('guest')) {
        if (msg.includes('documento') || msg.includes('document')) {
            return SyncErrorCode.INVALID_DOCUMENT;
        }
        return SyncErrorCode.INVALID_GUEST;
    }
    if (code === 'NETWORK_ERROR' || msg.includes('econnrefused') || msg.includes('network')) {
        return SyncErrorCode.NETWORK_ERROR;
    }
    if (code === 'TIMEOUT' || msg.includes('timeout') || msg.includes('etimedout')) {
        return SyncErrorCode.TIMEOUT;
    }
    if (
        code === 'PROVIDER_UNAVAILABLE' ||
        msg.includes('503') ||
        msg.includes('unavailable')
    ) {
        return SyncErrorCode.PROVIDER_UNAVAILABLE;
    }
    if (code === 'RUNNER_ERROR') return SyncErrorCode.RUNNER_ERROR;
    if (code === 'EXECUTOR_ERROR') return SyncErrorCode.EXECUTOR_ERROR;
    if (code === 'VALIDATION_ERROR' || code === 'PAYLOAD_INVALID') {
        return SyncErrorCode.VALIDATION_ERROR;
    }
    if (code && Object.values(SyncErrorCode).includes(code as SyncErrorCodeValue)) {
        return code as SyncErrorCodeValue;
    }
    return SyncErrorCode.UNKNOWN_ERROR;
}

/** Status UI derivado do sync_status persistido. */
export type SyncUiStatus =
    | 'SINCRONIZADA'
    | 'PENDENTE'
    | 'PROCESSANDO'
    | 'ERRO'
    | 'IGNORADA';

export function mapSyncStatusToUi(
    syncStatus?: string | null
): SyncUiStatus | null {
    const s = String(syncStatus || '').toUpperCase();
    if (!s) return null;
    if (s === 'SYNCED') return 'SINCRONIZADA';
    if (s === 'SYNCING') return 'PROCESSANDO';
    if (s === 'IGNORED') return 'IGNORADA';
    if (s === 'FAILED' || s === 'WAIT_MAPPING') return 'ERRO';
    if (
        s === 'NEW' ||
        s === 'VALIDATED' ||
        s === 'READY' ||
        s === 'QUEUED'
    ) {
        return 'PENDENTE';
    }
    return 'PENDENTE';
}

export function labelSeverity(sev?: string | null): string {
    const s = String(sev || '').toUpperCase();
    if (s === 'CRITICAL') return 'Erro crítico';
    if (s === 'ALERT') return 'Alerta';
    if (s === 'INFO') return 'Informativo';
    return sev || '—';
}
