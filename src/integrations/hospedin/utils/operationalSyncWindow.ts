import { getHospedinConfig } from '../constants/config';

export type HospedinSyncMode = 'incremental' | 'full';

export type OperationalSyncWindow = {
    /** Início do dia corrente (local). */
    todayStart: Date;
    /** checkout >= este instante mantém a reserva no modo incremental. */
    historyCutoff: Date;
    historicalSyncDays: number;
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
    now: Date = new Date(),
    historicalSyncDays?: number
): OperationalSyncWindow {
    const days =
        historicalSyncDays ?? getHospedinConfig().historicalSyncDays;
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const historyCutoff = new Date(todayStart);
    historyCutoff.setDate(historyCutoff.getDate() - days);
    return {
        todayStart,
        historyCutoff,
        historicalSyncDays: days,
    };
}

/**
 * Janela operacional (incremental):
 * check-in >= hoje  OR  checkout >= hoje - historicalSyncDays
 *
 * Sem check-in/checkout → fora da janela (descartada no incremental).
 */
export function isWithinOperationalSyncWindow(
    checkin: Date | string | null | undefined,
    checkout: Date | string | null | undefined,
    window: OperationalSyncWindow = getOperationalSyncWindow()
): boolean {
    const checkInDate = toValidDate(checkin);
    const checkOutDate = toValidDate(checkout);

    if (checkInDate && checkInDate >= window.todayStart) {
        return true;
    }
    if (checkOutDate && checkOutDate >= window.historyCutoff) {
        return true;
    }
    return false;
}

function toValidDate(
    value: Date | string | null | undefined
): Date | null {
    if (value == null || value === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}
