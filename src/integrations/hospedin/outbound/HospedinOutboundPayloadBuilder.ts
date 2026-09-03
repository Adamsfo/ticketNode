import { formatInTimeZone } from 'date-fns-tz';
import { StatusReservaHospedagem } from '../../../models/ReservaHospedagem';
import { TZ_HOSPEDAGEM } from '../../../utils/reservaSuiteUtils';
import type { OutboundPayloadHashInput } from './HospedinOutboundSnapshot';
import { normObs } from './HospedinOutboundSnapshot';

/** Payload operacional enviado ao POST /reservations (sem financeiro/pagamentos). */
export type HospedinOutboundReservationInput = {
    place_id: number;
    place_type_id: number;
    status: 'reservation';
    check_in: string;
    check_out: string;
    adults: number;
    children: number;
    exempt: number;
    note: string | null;
    guest_id: number;
    daily_cents: number;
    total_daily_cents: number;
    has_payment_coming_from_ota: false;
    has_breakfast: false;
    sale_channel_id: null;
};

/** PATCH de cancelamento outbound — somente status (homologado API Hospedin). */
export type HospedinOutboundReservationCancelPatch = {
    status: 'canceled';
};

export function buildOutboundCancelPatch(): HospedinOutboundReservationCancelPatch {
    return { status: 'canceled' };
}

/** PATCH parcial outbound — somente campos operacionais (sem financeiro). */
export type HospedinOutboundReservationPatch = {
    place_id?: number;
    place_type_id?: number;
    check_in?: string;
    check_out?: string;
    adults?: number;
    children?: number;
    note?: string | null;
};

export const OUTBOUND_CREATE_ELIGIBLE_STATUSES = new Set<string>([
    StatusReservaHospedagem.Confirmada,
    StatusReservaHospedagem.Hospedada,
]);

export const OUTBOUND_CREATE_DEFERRED_STATUS =
    StatusReservaHospedagem.AguardandoPagamento;

export const OUTBOUND_CREATE_TERMINAL_STATUSES = new Set<string>([
    StatusReservaHospedagem.Cancelada,
    StatusReservaHospedagem.Expirada,
    StatusReservaHospedagem.CheckOutRealizado,
]);

/**
 * Mesmo padrão do enqueue outbound (`periodKey` em HospedinOutboundEnqueueService).
 * HospedinApiClient serializa o objeto como JSON sem transformação adicional.
 */
export function formatOutboundCheckDatetime(d: Date | null | undefined): string | null {
    if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return null;
    return formatInTimeZone(d, TZ_HOSPEDAGEM, "yyyy-MM-dd'T'HH:mm");
}

function normObsLocal(v: string | null | undefined): string | null {
    return normObs(v);
}

export function buildOutboundNote(
    idReservaHospedagem: number,
    observacoes?: string | null
): string {
    const baseNote = normObsLocal(observacoes);
    const jangoRef = `Reserva Jango #${idReservaHospedagem}`;
    if (!baseNote) return jangoRef;
    return baseNote.includes(jangoRef) ? baseNote : `${baseNote}\n${jangoRef}`;
}

export type OutboundHashInputDiff = {
    changedFields: Array<keyof OutboundPayloadHashInput>;
    patch: HospedinOutboundReservationPatch;
};

export type BuildOutboundUpdatePatchInput = {
    idReservaHospedagem: number;
    before: OutboundPayloadHashInput;
    after: OutboundPayloadHashInput;
    placeId?: number;
    placeTypeId?: number;
};

/**
 * Diff entre baseline sincronizado e estado Jango atual.
 * Somente campos com PATCH suportado (sem status, hóspedes, financeiro).
 */
export function diffOutboundHashInputs(
    before: OutboundPayloadHashInput,
    after: OutboundPayloadHashInput
): Array<keyof OutboundPayloadHashInput> {
    const fields: Array<keyof OutboundPayloadHashInput> = [
        'checkin',
        'checkout',
        'idEventoSuite',
        'observacoes',
        'adultos',
        'criancas',
    ];

    return fields.filter((field) => before[field] !== after[field]);
}

export function buildOutboundUpdatePatch(
    input: BuildOutboundUpdatePatchInput
): OutboundHashInputDiff {
    const { before, after } = input;
    const changedFields = diffOutboundHashInputs(before, after);
    const patch: HospedinOutboundReservationPatch = {};

    if (before.checkin !== after.checkin && after.checkin) {
        patch.check_in = after.checkin;
    }
    if (before.checkout !== after.checkout && after.checkout) {
        patch.check_out = after.checkout;
    }
    if (before.idEventoSuite !== after.idEventoSuite) {
        const placeId = Number(input.placeId);
        const placeTypeId = Number(input.placeTypeId);
        if (
            !Number.isFinite(placeId) ||
            placeId <= 0 ||
            !Number.isFinite(placeTypeId) ||
            placeTypeId <= 0
        ) {
            throw new Error(
                'place_id/place_type_id obrigatórios para UPDATE de suíte.'
            );
        }
        patch.place_id = placeId;
        patch.place_type_id = placeTypeId;
    }
    if (before.adultos !== after.adultos) {
        patch.adults = Math.max(1, Math.floor(Number(after.adultos) || 0));
    }
    if (before.criancas !== after.criancas) {
        patch.children = Math.max(0, Math.floor(Number(after.criancas) || 0));
    }
    if (before.observacoes !== after.observacoes) {
        patch.note = buildOutboundNote(
            input.idReservaHospedagem,
            after.observacoes
        );
    }

    return { changedFields, patch };
}

function toCents(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
}

export type BuildOutboundPayloadInput = {
    idReservaHospedagem: number;
    checkin: Date;
    checkout: Date;
    observacaoImportada?: string | null;
    observacoes?: string | null;
    adultos: number;
    criancas: number;
    preco: number;
    valorTotal: number;
    placeId: number;
    placeTypeId: number;
    guestId: number;
};

export function buildOutboundReservationPayload(
    input: BuildOutboundPayloadInput
): HospedinOutboundReservationInput {
    const checkIn = formatOutboundCheckDatetime(input.checkin);
    const checkOut = formatOutboundCheckDatetime(input.checkout);
    if (!checkIn || !checkOut) {
        throw new Error('Check-in/check-out inválidos para outbound Hospedin.');
    }

    const baseNote =
        normObsLocal(input.observacaoImportada) ?? normObsLocal(input.observacoes);
    const jangoRef = `Reserva Jango #${input.idReservaHospedagem}`;
    const note = baseNote
        ? baseNote.includes(jangoRef)
            ? baseNote
            : `${baseNote}\n${jangoRef}`
        : jangoRef;

    const adults = Math.max(1, Math.floor(Number(input.adultos) || 0));
    const children = Math.max(0, Math.floor(Number(input.criancas) || 0));

    return {
        place_id: input.placeId,
        place_type_id: input.placeTypeId,
        status: 'reservation',
        check_in: checkIn,
        check_out: checkOut,
        adults,
        children,
        exempt: 0,
        note,
        guest_id: input.guestId,
        daily_cents: toCents(input.preco),
        total_daily_cents: toCents(input.valorTotal),
        has_payment_coming_from_ota: false,
        has_breakfast: false,
        sale_channel_id: null,
    };
}
