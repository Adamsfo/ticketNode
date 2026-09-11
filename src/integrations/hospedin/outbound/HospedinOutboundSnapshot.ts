import { createHash } from 'crypto';
import { formatInTimeZone } from 'date-fns-tz';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaSuite } from '../../../models/ReservaSuite';
import { mergeReservaObservacoes } from '../../../utils/reservaObservacoesUtils';
import { TZ_HOSPEDAGEM } from '../../../utils/reservaSuiteUtils';
import {
    resolveOutboundSalePriceCents,
    valorTotalToSalePriceCents,
} from './HospedinOutboundSalePayloadBuilder';

/**
 * Snapshot operacional outbound — somente campos com PATCH suportado.
 *
 * Fora do hash operacional (e do PATCH outbound atual):
 * - status operacional Jango (check-in/check-out/cancelamento)
 * - hospedes[] / guest_id pós-criação (sincronização de hóspede fica fora do escopo)
 * - pagamentos (valorPago, saldoPendente)
 *
 * `valorTotalCents` (raiz) permanece na baseline para compatibilidade com UPDATE
 * legado até a Etapa 3. `suites[].valorTotalCents` detecta mudanças por linha.
 */
export type OutboundPayloadSnapshot = {
    checkin: Date | null;
    checkout: Date | null;
    idEventoSuite: number | null;
    observacoes: string | null;
    adultos: number;
    criancas: number;
};

export type OutboundSuiteHashInput = {
    idReservaSuite: number;
    idEventoSuite: number;
    adultos: number;
    criancas: number;
    valorTotalCents: number;
};

export type OutboundPayloadHashInput = {
    checkin: string | null;
    checkout: string | null;
    observacoes: string | null;
    suites: OutboundSuiteHashInput[];
    /** Campos legados espelhados da 1ª suíte — compat UPDATE atual (Etapa 3). */
    idEventoSuite: number | null;
    adultos: number;
    criancas: number;
    /** Total da ReservaHospedagem — compat financeHashChanged atual. */
    valorTotalCents: number;
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

function sortSuiteLines<T extends { id?: number }>(suites: T[]): T[] {
    return [...suites].sort((a, b) => Number(a.id) - Number(b.id));
}

function normalizeSuiteHashInput(raw: unknown): OutboundSuiteHashInput | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const row = raw as Record<string, unknown>;
    const idReservaSuite = Math.max(
        0,
        Math.floor(Number(row.idReservaSuite) || 0)
    );
    const idEventoSuite = Number(row.idEventoSuite);
    if (!Number.isFinite(idEventoSuite) || idEventoSuite <= 0) {
        return null;
    }
    return {
        idReservaSuite,
        idEventoSuite,
        adultos: Math.max(0, Math.floor(Number(row.adultos) || 0)),
        criancas: Math.max(0, Math.floor(Number(row.criancas) || 0)),
        valorTotalCents: Math.max(
            0,
            Math.floor(Number(row.valorTotalCents) || 0)
        ),
    };
}

export function buildSuiteHashInputsFromReserva(
    hospedagem: ReservaHospedagem & {
        ReservaSuite?: ReservaSuite[];
    }
): OutboundSuiteHashInput[] {
    const suites = sortSuiteLines(hospedagem.ReservaSuite ?? []);
    return suites
        .map((linha) => {
            const idEventoSuite = Number(linha.idEventoSuite);
            if (!Number.isFinite(idEventoSuite) || idEventoSuite <= 0) {
                return null;
            }
            return {
                idReservaSuite: Number(linha.id),
                idEventoSuite,
                adultos: Math.max(0, Math.floor(Number(linha.adultos) || 0)),
                criancas: Math.max(0, Math.floor(Number(linha.criancas) || 0)),
                valorTotalCents: valorTotalToSalePriceCents(linha.valorTotal),
            };
        })
        .filter((item): item is OutboundSuiteHashInput => item != null);
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
    snapshot: OutboundPayloadSnapshot,
    valorTotalCents = 0,
    suites: OutboundSuiteHashInput[] = []
): OutboundPayloadHashInput {
    const normalizedSuites =
        suites.length > 0
            ? suites
            : snapshot.idEventoSuite != null
              ? [
                    {
                        idReservaSuite: 0,
                        idEventoSuite: snapshot.idEventoSuite,
                        adultos: snapshot.adultos,
                        criancas: snapshot.criancas,
                        valorTotalCents: Math.max(
                            0,
                            Math.floor(Number(valorTotalCents) || 0)
                        ),
                    },
                ]
              : [];

    const first = normalizedSuites[0];

    return {
        checkin: periodKey(snapshot.checkin),
        checkout: periodKey(snapshot.checkout),
        observacoes: snapshot.observacoes,
        suites: normalizedSuites,
        idEventoSuite: first?.idEventoSuite ?? snapshot.idEventoSuite,
        adultos: first?.adultos ?? snapshot.adultos,
        criancas: first?.criancas ?? snapshot.criancas,
        valorTotalCents: Math.max(0, Math.floor(Number(valorTotalCents) || 0)),
    };
}

export function buildSyncBaselineFromReserva(
    hospedagem: ReservaHospedagem & {
        observacaoImportada?: string | null;
        observacaoOperador?: string | null;
        observacoes?: string | null;
        valorTotal?: unknown;
        preco?: unknown;
        taxaServico?: unknown;
        ReservaSuite?: ReservaSuite[];
    }
): OutboundPayloadHashInput {
    const suites = buildSuiteHashInputsFromReserva(hospedagem);
    const snapshot = buildSnapshotFromReserva(hospedagem);
    const valorTotalCents = resolveOutboundSalePriceCents(hospedagem);

    return snapshotToHashInput(snapshot, valorTotalCents, suites);
}

export function financeHashChanged(
    before: OutboundPayloadHashInput,
    after: OutboundPayloadHashInput
): boolean {
    return before.valorTotalCents !== after.valorTotalCents;
}

export function findSuiteInBaseline(
    baseline: OutboundPayloadHashInput,
    idReservaSuite: number
): OutboundSuiteHashInput | null {
    return (
        baseline.suites.find(
            (suite) => suite.idReservaSuite === idReservaSuite
        ) ?? null
    );
}

/** Baseline legado (idReservaSuite=0) casa com a única suíte atual. */
export function resolveBeforeSuiteInBaseline(
    before: OutboundPayloadHashInput,
    afterSuite: OutboundSuiteHashInput,
    suiteCount: number
): OutboundSuiteHashInput | null {
    const found = findSuiteInBaseline(before, afterSuite.idReservaSuite);
    if (found) {
        return found;
    }
    if (
        suiteCount === 1 &&
        before.suites.length === 1 &&
        before.suites[0].idReservaSuite === 0
    ) {
        return before.suites[0];
    }
    return null;
}

export function applySuiteFinanceToBaseline(
    baseline: OutboundPayloadHashInput,
    idReservaSuite: number,
    afterSuite: OutboundSuiteHashInput
): OutboundPayloadHashInput {
    const suites = baseline.suites.map((suite) =>
        suite.idReservaSuite === idReservaSuite
            ? {
                  ...suite,
                  valorTotalCents: afterSuite.valorTotalCents,
              }
            : suite
    );
    return {
        ...baseline,
        suites,
        valorTotalCents: afterSuite.valorTotalCents,
    };
}

export function suiteFinanceChanged(
    beforeSuite: OutboundSuiteHashInput | null,
    afterSuite: OutboundSuiteHashInput | null
): boolean {
    if (!beforeSuite || !afterSuite) {
        return Boolean(afterSuite);
    }
    return beforeSuite.valorTotalCents !== afterSuite.valorTotalCents;
}

export function anySuiteFinanceChanged(
    before: OutboundPayloadHashInput,
    after: OutboundPayloadHashInput
): boolean {
    for (const afterSuite of after.suites) {
        const beforeSuite = findSuiteInBaseline(
            before,
            afterSuite.idReservaSuite
        );
        if (suiteFinanceChanged(beforeSuite, afterSuite)) {
            return true;
        }
    }
    return false;
}

export function withLegacyRootFields(
    input: OutboundPayloadHashInput
): OutboundPayloadHashInput {
    const first = input.suites[0];
    return {
        ...input,
        idEventoSuite: first?.idEventoSuite ?? input.idEventoSuite,
        adultos: first?.adultos ?? input.adultos,
        criancas: first?.criancas ?? input.criancas,
    };
}

export function applySharedPatchToBaseline(
    before: OutboundPayloadHashInput,
    after: OutboundPayloadHashInput,
    patch: {
        check_in?: string;
        check_out?: string;
        note?: string | null;
    }
): OutboundPayloadHashInput {
    return withLegacyRootFields({
        ...before,
        checkin: patch.check_in ?? before.checkin,
        checkout: patch.check_out ?? before.checkout,
        observacoes:
            patch.note !== undefined ? after.observacoes : before.observacoes,
    });
}

export function applySuitePatchToBaseline(
    baseline: OutboundPayloadHashInput,
    idReservaSuite: number,
    afterSuite: OutboundSuiteHashInput,
    patch: {
        place_id?: number;
        adults?: number;
        children?: number;
    }
): OutboundPayloadHashInput {
    const suites = baseline.suites.map((suite) => {
        if (suite.idReservaSuite !== idReservaSuite) {
            return suite;
        }
        return {
            ...suite,
            idEventoSuite:
                patch.place_id != null
                    ? afterSuite.idEventoSuite
                    : suite.idEventoSuite,
            adultos: patch.adults ?? suite.adultos,
            criancas: patch.children ?? suite.criancas,
        };
    });

    return withLegacyRootFields({
        ...baseline,
        suites,
    });
}

function legacySuiteFromFlatFields(
    raw: Record<string, unknown>
): OutboundSuiteHashInput[] {
    const idEventoSuite =
        raw.idEventoSuite != null ? Number(raw.idEventoSuite) : null;
    if (idEventoSuite == null || !Number.isFinite(idEventoSuite)) {
        return [];
    }

    return [
        {
            idReservaSuite: 0,
            idEventoSuite,
            adultos: Math.max(0, Math.floor(Number(raw.adultos) || 0)),
            criancas: Math.max(0, Math.floor(Number(raw.criancas) || 0)),
            valorTotalCents: Math.max(
                0,
                Math.floor(Number(raw.valorTotalCents) || 0)
            ),
        },
    ];
}

/** Normaliza baseline legado (campos removidos do hash: status, hospedes). */
export function normalizeHashInput(
    raw: Record<string, unknown>
): OutboundPayloadHashInput {
    const suitesFromArray = Array.isArray(raw.suites)
        ? raw.suites
              .map((item) => normalizeSuiteHashInput(item))
              .filter((item): item is OutboundSuiteHashInput => item != null)
              .sort((a, b) => a.idReservaSuite - b.idReservaSuite)
        : [];

    const suites =
        suitesFromArray.length > 0
            ? suitesFromArray
            : legacySuiteFromFlatFields(raw);

    const first = suites[0];

    return {
        checkin:
            raw.checkin != null ? String(raw.checkin) : null,
        checkout:
            raw.checkout != null ? String(raw.checkout) : null,
        observacoes:
            raw.observacoes != null ? String(raw.observacoes) : null,
        suites,
        idEventoSuite:
            first?.idEventoSuite ??
            (raw.idEventoSuite != null ? Number(raw.idEventoSuite) : null),
        adultos:
            first?.adultos ??
            Math.max(0, Math.floor(Number(raw.adultos) || 0)),
        criancas:
            first?.criancas ??
            Math.max(0, Math.floor(Number(raw.criancas) || 0)),
        valorTotalCents: Math.max(
            0,
            Math.floor(Number(raw.valorTotalCents) || 0)
        ),
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
