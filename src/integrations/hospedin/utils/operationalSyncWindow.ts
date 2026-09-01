export type HospedinSyncMode = 'incremental' | 'full';

/** Dias retroativos inclusos na janela incremental (check_in >= hoje - N). */
export const OPERATIONAL_SYNC_LOOKBACK_DAYS = 7;

export type OperationalSyncWindow = {
    /**
     * Início da janela operacional (local):
     * início do dia de (hoje - OPERATIONAL_SYNC_LOOKBACK_DAYS).
     * Sem limite superior — reservas futuras entram normalmente.
     */
    todayStart: Date;
};

export function parseHospedinSyncMode(
    value: unknown,
    fallback: HospedinSyncMode = 'incremental'
): HospedinSyncMode {
    const raw = String(value ?? '')
        .trim()
        .toLowerCase();
    if (raw === 'full' || raw === 'complete' || raw === 'completa') {
        return 'full';
    }
    if (
        raw === 'incremental' ||
        raw === 'operational' ||
        raw === 'operacional' ||
        raw === 'default'
    ) {
        return 'incremental';
    }
    return fallback;
}

export function getOperationalSyncWindow(
    now: Date = new Date()
): OperationalSyncWindow {
    const windowStart = new Date(now);
    windowStart.setHours(0, 0, 0, 0);
    windowStart.setDate(
        windowStart.getDate() - OPERATIONAL_SYNC_LOOKBACK_DAYS
    );
    return { todayStart: windowStart };
}

/**
 * Janela operacional (incremental):
 * check_in >= (hoje - 7 dias) às 00:00:00 local.
 * Sem teto futuro — qualquer check-in a partir dessa data entra.
 *
 * Sem check-in válido → fora da janela (descartada no incremental).
 * O parâmetro checkout é ignorado (mantido na assinatura por compatibilidade).
 */
export function isWithinOperationalSyncWindow(
    checkin: Date | string | null | undefined,
    _checkout?: Date | string | null | undefined,
    window: OperationalSyncWindow = getOperationalSyncWindow()
): boolean {
    const checkInDate = toValidDate(checkin);
    if (!checkInDate) return false;
    return checkInDate >= window.todayStart;
}

function toValidDate(
    value: Date | string | null | undefined
): Date | null {
    if (value == null || value === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}
