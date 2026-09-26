import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { TZ_HOSPEDAGEM } from '../../../utils/reservaSuiteUtils';

export type HospedinSyncMode = 'incremental' | 'full';

/** @deprecated Janela retroativa substituída por check-in futuro (minuto). Mantido só para compat de imports. */
export const OPERATIONAL_SYNC_LOOKBACK_DAYS = 7;

export type OperationalSyncWindow = {
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

/** @deprecated Use {@link getCheckinSqlExclusiveThreshold} / {@link isCheckinAfterNow}. */
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

export function toValidCheckinDate(
    value: Date | string | null | undefined
): Date | null {
    if (value == null || value === '') return null;
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

/** Chave `yyyy-MM-dd HH:mm` no fuso de hospedagem (mesmo de outbound). */
export function formatCheckinMinuteKey(
    value: Date | string | null | undefined
): string | null {
    const d = toValidCheckinDate(value);
    if (!d) return null;
    return formatInTimeZone(d, TZ_HOSPEDAGEM, 'yyyy-MM-dd HH:mm');
}

/**
 * Regra operacional: check-in estritamente após o minuto corrente (fuso hospedagem).
 * Ex.: agora 03:26 → 03:26 não entra; 03:27 entra.
 */
export function isCheckinAfterNow(
    checkin: Date | string | null | undefined,
    now: Date = new Date()
): boolean {
    const checkKey = formatCheckinMinuteKey(checkin);
    const nowKey = formatCheckinMinuteKey(now);
    if (!checkKey || !nowKey) return false;
    return checkKey > nowKey;
}

/** Mesma regra de minuto para checkout (UPDATE outbound em estadia ativa). */
export function isCheckoutAfterNow(
    checkout: Date | string | null | undefined,
    now: Date = new Date()
): boolean {
    const checkKey = formatCheckinMinuteKey(checkout);
    const nowKey = formatCheckinMinuteKey(now);
    if (!checkKey || !nowKey) return false;
    return checkKey > nowKey;
}

/**
 * Limite exclusivo SQL: `checkin > threshold` equivale à regra por minuto.
 */
export function getCheckinSqlExclusiveThreshold(now: Date = new Date()): Date {
    const nowKey = formatCheckinMinuteKey(now);
    if (!nowKey) {
        return now;
    }
    const [date, time] = nowKey.split(' ');
    return fromZonedTime(`${date}T${time}:59.999`, TZ_HOSPEDAGEM);
}

/**
 * Incremental: somente reservas com check-in futuro (minuto).
 * Modo full: sempre true (sem filtro temporal).
 */
export function isWithinOperationalSyncWindow(
    checkin: Date | string | null | undefined,
    _checkout?: Date | string | null | undefined,
    _window?: OperationalSyncWindow,
    now: Date = new Date()
): boolean {
    return isCheckinAfterNow(checkin, now);
}
