/**
 * Utilitários para descoberta de account_id a partir do JWT Hospedin.
 * Não valida assinatura — apenas lê o payload para candidatos.
 */

const ACCOUNT_KEYS = [
    'account_id',
    'accountId',
    'account',
    'accounts',
    'current_account_id',
    'currentAccountId',
    'slug',
    'account_slug',
    'accountSlug',
];

function pushCandidate(out: string[], value: unknown): void {
    if (value === null || value === undefined) return;

    if (typeof value === 'string' || typeof value === 'number') {
        const s = String(value).trim();
        if (s) out.push(s);
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) pushCandidate(out, item);
        return;
    }

    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        for (const key of ACCOUNT_KEYS) {
            if (key in obj) pushCandidate(out, obj[key]);
        }
        if ('id' in obj) pushCandidate(out, obj.id);
    }
}

export function decodeJwtPayload(
    token: string
): Record<string, unknown> | null {
    try {
        const parts = token.split('.');
        if (parts.length < 2) return null;
        const payload = parts[1]
            .replace(/-/g, '+')
            .replace(/_/g, '/')
            .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
        const json = Buffer.from(payload, 'base64').toString('utf8');
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

/** Extrai candidatos a account_id/slug do payload do JWT. */
export function extractAccountCandidatesFromJwt(token: string): string[] {
    const payload = decodeJwtPayload(token);
    if (!payload) return [];

    const found: string[] = [];
    for (const key of ACCOUNT_KEYS) {
        if (key in payload) pushCandidate(found, payload[key]);
    }

    // Alguns tokens aninham em user / data
    pushCandidate(found, payload.user);
    pushCandidate(found, payload.data);

    return [...new Set(found)];
}

export function uniqueCandidates(
    ...groups: Array<string | null | undefined | string[]>
): string[] {
    const out: string[] = [];
    for (const g of groups) {
        if (!g) continue;
        if (Array.isArray(g)) {
            for (const item of g) {
                const s = String(item || '').trim();
                if (s) out.push(s);
            }
        } else {
            const s = String(g).trim();
            if (s) out.push(s);
        }
    }
    return [...new Set(out)];
}
