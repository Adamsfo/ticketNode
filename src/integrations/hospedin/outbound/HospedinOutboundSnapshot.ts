import { createHash } from 'crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaSuite } from '../../../models/ReservaSuite';
import { mergeReservaObservacoes } from '../../../utils/reservaObservacoesUtils';
import { TZ_HOSPEDAGEM } from '../../../utils/reservaSuiteUtils';

/**
 * Snapshot operacional outbound — somente campos com PATCH suportado.
 *
 * Fora do hash (e do UPDATE outbound atual):
 * - status operacional Jango (check-in/check-out/cancelamento)
 * - hospedes[] / guest_id pós-criação (sincronização de hóspede fica fora do escopo)
 * - financeiro (valorPago, saldoPendente, pagamentos)
 */
export type OutboundPayloadSnapshot = {
    checkin: Date | null;
    checkout: Date | null;
    idEventoSuite: number | null;
    observacoes: string | null;
    adultos: number;
    criancas: number;
};

export type OutboundPayloadHashInput = {
    checkin: string | null;
    checkout: string | null;
    idEventoSuite: number | null;
    observacoes: string | null;
    adultos: number;
    criancas: number;
};

export function periodKey(d: Date | null | undefined): string | null {
    if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return null;
    return formatInTimeZone(d, TZ_HOSPEDAGEM, "yyyy-MM-dd'T'HH:mm");
}

export function normObs(v: string | null | undefined): string | null {
    const s = String(v || '').trim();
    return s ? s : null;
}

/**
 * Texto operacional da reserva para hash outbound.
 * Prioriza `observacoes` (merge persistido) e cai no merge importada+operador.
 */
export function resolveOutboundObservacoes(hospedagem: {
    observacaoImportada?: string | null;
    observacaoOperador?: string | null;
    observacoes?: string | null;
}): string | null {
    const merged =
        normObs(hospedagem.observacoes) ??
        normObs(
            mergeReservaObservacoes(
                hospedagem.observacaoImportada,
                hospedagem.observacaoOperador
            )
        );
    return merged;
}

export function hashOutboundPayload(payload: OutboundPayloadHashInput): string {
    const raw = JSON.stringify(payload);
    return createHash('sha256').update(raw).digest('hex');
}

export function buildSnapshotFromReserva(
    hospedagem: ReservaHospedagem & {
        observacaoImportada?: string | null;
        observacaoOperador?: string | null;
        observacoes?: string | null;
        ReservaSuite?: ReservaSuite[];
    }
): OutboundPayloadSnapshot {
    const suites = hospedagem.ReservaSuite ?? [];
    const linha = suites[0];

    return {
        checkin: hospedagem.checkin ? new Date(hospedagem.checkin) : null,
        checkout: hospedagem.checkout ? new Date(hospedagem.checkout) : null,
        idEventoSuite: linha ? Number(linha.idEventoSuite) || null : null,
        observacoes: resolveOutboundObservacoes(hospedagem),
        adultos: linha ? Number(linha.adultos || 0) : 0,
        criancas: linha ? Number(linha.criancas || 0) : 0,
    };
}

export function snapshotToHashInput(
    snapshot: OutboundPayloadSnapshot
): OutboundPayloadHashInput {
    return {
        checkin: periodKey(snapshot.checkin),
        checkout: periodKey(snapshot.checkout),
        idEventoSuite: snapshot.idEventoSuite,
        observacoes: snapshot.observacoes,
        adultos: snapshot.adultos,
        criancas: snapshot.criancas,
    };
}

/** Normaliza baseline legado (campos removidos do hash: status, hospedes). */
export function normalizeHashInput(
    raw: Record<string, unknown>
): OutboundPayloadHashInput {
    return {
        checkin:
            raw.checkin != null ? String(raw.checkin) : null,
        checkout:
            raw.checkout != null ? String(raw.checkout) : null,
        idEventoSuite:
            raw.idEventoSuite != null ? Number(raw.idEventoSuite) : null,
        observacoes:
            raw.observacoes != null ? String(raw.observacoes) : null,
        adultos: Math.max(0, Math.floor(Number(raw.adultos) || 0)),
        criancas: Math.max(0, Math.floor(Number(raw.criancas) || 0)),
    };
}

export function parseSyncedHashInputJson(
    raw: string | null | undefined
): OutboundPayloadHashInput | null {
    if (!raw || !String(raw).trim()) return null;
    try {
        const parsed = JSON.parse(String(raw)) as Record<string, unknown>;
        if (!parsed || typeof parsed !== 'object') return null;
        return normalizeHashInput(parsed);
    } catch {
        return null;
    }
}

export function serializeHashInput(input: OutboundPayloadHashInput): string {
    return JSON.stringify(input);
}
