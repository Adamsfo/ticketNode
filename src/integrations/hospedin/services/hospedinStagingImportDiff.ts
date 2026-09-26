import { createHash } from 'crypto';
import type { InternalHospedinReservation } from '../dto';

/** Campos técnicos/voláteis — não representam mudança comercial no hash de import. */
export const STAGING_HASH_IGNORE_KEYS = new Set([
    '_jango_guest_enriched_at',
    '_jango_guest_enriched',
]);

/**
 * Normaliza payload para comparação estável (ordem de chaves + ignora ruído técnico).
 * O payload gravado em `payload_json` permanece completo.
 */
export function canonicalizePayloadForStagingHash(
    payload: unknown
): unknown {
    if (payload == null) {
        return {};
    }
    if (typeof payload === 'string') {
        try {
            return canonicalizePayloadForStagingHash(JSON.parse(payload));
        } catch {
            return payload;
        }
    }
    if (Array.isArray(payload)) {
        return payload.map((item) => canonicalizePayloadForStagingHash(item));
    }
    if (typeof payload !== 'object') {
        return payload;
    }
    const obj = payload as Record<string, unknown>;
    const keys = Object.keys(obj)
        .filter((k) => !STAGING_HASH_IGNORE_KEYS.has(k))
        .sort();
    const out: Record<string, unknown> = {};
    for (const key of keys) {
        out[key] = canonicalizePayloadForStagingHash(obj[key]);
    }
    return out;
}

/** Hash do import — canonicalizado (não idêntico ao hash bruto da validação). */
export function hashStagingPayload(payload: unknown): string {
    const canonical = canonicalizePayloadForStagingHash(payload);
    const raw =
        typeof canonical === 'string'
            ? canonical
            : JSON.stringify(canonical ?? {});
    return createHash('sha256').update(raw).digest('hex');
}

export type StagingImportChangeKind = 'created' | 'updated' | 'unchanged';

export type StagingRowSnapshot = {
    status: string | null;
    checkin: Date | null;
    checkout: Date | null;
    payload_json: object | null;
};

function dateMs(value: Date | string | null | undefined): number | null {
    if (value == null) return null;
    const d = value instanceof Date ? value : new Date(value);
    const t = d.getTime();
    return Number.isFinite(t) ? t : null;
}

/**
 * Compara staging existente com o payload que seria gravado.
 * Não usa updated_at local — só conteúdo relevante.
 */
export function classifyStagingImportChange(
    existing: StagingRowSnapshot | null,
    incoming: Pick<
        InternalHospedinReservation,
        'status' | 'checkin' | 'checkout' | 'payload_json'
    >
): StagingImportChangeKind {
    if (!existing) {
        return 'created';
    }

    const newHash = hashStagingPayload(incoming.payload_json);
    const oldHash = hashStagingPayload(existing.payload_json);
    if (newHash !== oldHash) {
        return 'updated';
    }

    if (String(existing.status ?? '') !== String(incoming.status ?? '')) {
        return 'updated';
    }
    if (dateMs(existing.checkin) !== dateMs(incoming.checkin)) {
        return 'updated';
    }
    if (dateMs(existing.checkout) !== dateMs(incoming.checkout)) {
        return 'updated';
    }

    return 'unchanged';
}

export function hasInboundImportWork(input: {
    created: number;
    updated: number;
}): boolean {
    return input.created + input.updated > 0;
}
