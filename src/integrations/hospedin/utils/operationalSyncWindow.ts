export type HospedinSyncMode = 'incremental' | 'full';

export type OperationalSyncWindow = {
    /** Início do dia corrente (local). */
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
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    return { todayStart };
}

/**
 * Janela operacional (incremental):
 * somente check_in >= início do dia corrente.
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
