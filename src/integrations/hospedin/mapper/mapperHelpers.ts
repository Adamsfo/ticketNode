/**
 * Helpers de conversão estrutural (somente tipos/parsing).
 * Usados pelos Mappers — sem regra de negócio.
 */

export function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

export function asNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

export function asString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const s = String(value).trim();
    return s || null;
}

export function asBoolean(value: unknown, fallback = true): boolean {
    if (typeof value === 'boolean') return value;
    if (value === 0 || value === '0' || value === 'false') return false;
    if (value === 1 || value === '1' || value === 'true') return true;
    return fallback;
}

export function asDate(value: unknown): Date | null {
    if (value == null || value === '') return null;
    const d = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d;
}
