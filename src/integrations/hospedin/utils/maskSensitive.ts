/**
 * Máscaras de segredo compartilhadas (logger + sync_log + client).
 */

export function maskSensitiveDeep(value: unknown): unknown {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map(maskSensitiveDeep);
    if (typeof value !== 'object') return value;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (/password|token|authorization|bearer/i.test(k)) {
            out[k] = '********';
        } else {
            out[k] = maskSensitiveDeep(v);
        }
    }
    return out;
}

export function maskBearer(value: string | null | undefined): string | null {
    if (!value) return null;
    if (value.length <= 8) return '********';
    return `${value.slice(0, 4)}…********`;
}
