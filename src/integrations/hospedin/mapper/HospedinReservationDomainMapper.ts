import { TipoReservaHospede } from '../../../models/ReservaHospede';
import type { HospedinReservation } from '../../../models/HospedinReservation';
import type {
    HospedeCheckoutItem,
    SuiteCheckoutItem,
} from '../../../services/reservaSuiteService';
import type { HospedinReservationDto } from '../dto';
import { HospedinReservationMapper } from '../mapper/HospedinReservationMapper';
import { asDate, asNumber, asRecord, asString } from '../mapper/mapperHelpers';
import type { ResolvedInternalSuite } from '../services/PlaceSuiteResolver';
import type { ReservationDiffSnapshot } from '../services/ReservationDiffService';

export const PAYLOAD_INCOMPLETE = 'PAYLOAD_INCOMPLETE';

export class HospedinDomainMappingError extends Error {
    readonly code: string;

    constructor(message: string, code = PAYLOAD_INCOMPLETE) {
        super(message);
        this.name = 'HospedinDomainMappingError';
        this.code = code;
    }
}

export type HospedinToJangoCreateParams = {
    idEvento: number;
    checkin: Date;
    checkout: Date;
    suites: SuiteCheckoutItem[];
    observacoes: string | null;
    externalReservationId: number;
};

/**
 * Transformação Hospedin (DTO/staging) → parâmetros do domínio Jango.
 * Sem persistência. Sem regras de disponibilidade/tarifa.
 * Não criar hóspedes fictícios — falha com PAYLOAD_INCOMPLETE.
 *
 * Distinto de HospedinReservationMapper (API → staging).
 */
export const HospedinReservationDomainMapper = {
    toDtoFromStaging(row: HospedinReservation): HospedinReservationDto {
        const payload = readPayload(row);
        return HospedinReservationMapper.toDto({
            ...(payload || {}),
            id: payload?.id ?? row.reservation_id,
            status: payload?.status ?? row.status,
            check_in: payload?.check_in ?? row.checkin,
            check_out: payload?.check_out ?? row.checkout,
            place_id: payload?.place_id,
            place_type_id: payload?.place_type_id,
            searchable_code: payload?.searchable_code,
        });
    },

    toCreateParams(input: {
        staging: HospedinReservation;
        resolvedSuite: ResolvedInternalSuite & { found: true };
    }): HospedinToJangoCreateParams {
        const dto = this.toDtoFromStaging(input.staging);
        const payload = dto.sourcePayload || {};

        if (!dto.checkin || !dto.checkout) {
            throw new HospedinDomainMappingError(
                'check_in/check_out ausentes no staging Hospedin.',
                PAYLOAD_INCOMPLETE
            );
        }

        if (dto.checkout.getTime() <= dto.checkin.getTime()) {
            throw new HospedinDomainMappingError(
                'checkout deve ser posterior ao checkin.',
                PAYLOAD_INCOMPLETE
            );
        }

        if (input.resolvedSuite.idEvento == null) {
            throw new HospedinDomainMappingError(
                'Suíte resolvida sem idEvento — remapeie o place com EventoSuite válido.',
                PAYLOAD_INCOMPLETE
            );
        }

        const guests = extractGuests(payload);
        if (guests.length === 0) {
            throw new HospedinDomainMappingError(
                'Nenhum hóspede encontrado no payload Hospedin. Importe com detalhes ou complete o payload.',
                PAYLOAD_INCOMPLETE
            );
        }

        const adultos = guests.filter(
            (g) => g.tipo === TipoReservaHospede.Adulto
        ).length;
        const criancas = guests.filter(
            (g) => g.tipo === TipoReservaHospede.Crianca
        ).length;

        if (adultos < 1) {
            throw new HospedinDomainMappingError(
                'É necessário ao menos 1 hóspede adulto no payload Hospedin.',
                PAYLOAD_INCOMPLETE
            );
        }

        for (const g of guests) {
            if (g.tipo === TipoReservaHospede.Crianca && !g.dataNascimento) {
                throw new HospedinDomainMappingError(
                    `Criança "${g.nome}" sem dataNascimento no payload Hospedin.`,
                    PAYLOAD_INCOMPLETE
                );
            }
        }

        const observacoes = buildObservacoes(dto, payload);

        return {
            idEvento: input.resolvedSuite.idEvento,
            checkin: dto.checkin,
            checkout: dto.checkout,
            externalReservationId: dto.reservationId,
            observacoes,
            suites: [
                {
                    idEventoSuite: input.resolvedSuite.idEventoSuite,
                    adultos,
                    criancas,
                    hospedes: guests,
                },
            ],
        };
    },

    /**
     * Intenção operacional para UPDATE (sem valores financeiros).
     * Hóspedes nomeados quando existirem no payload; senão lista vazia
     * (contagens adults/children ainda entram no Diff).
     */
    toUpdateSnapshot(input: {
        staging: HospedinReservation;
        resolvedSuite: ResolvedInternalSuite & { found: true };
    }): ReservationDiffSnapshot {
        const dto = this.toDtoFromStaging(input.staging);
        const payload = dto.sourcePayload || {};

        if (!dto.checkin || !dto.checkout) {
            throw new HospedinDomainMappingError(
                'check_in/check_out ausentes no staging Hospedin.',
                PAYLOAD_INCOMPLETE
            );
        }

        const guests = extractGuests(payload);
        const adultosPayload = asNumber(payload.adults) ?? asNumber(payload.adultos);
        const criancasPayload =
            asNumber(payload.children) ?? asNumber(payload.criancas);

        const adultos =
            guests.filter((g) => g.tipo === TipoReservaHospede.Adulto).length ||
            Number(adultosPayload || 0);
        const criancas =
            guests.filter((g) => g.tipo === TipoReservaHospede.Crianca).length ||
            Number(criancasPayload || 0);

        return {
            checkin: dto.checkin,
            checkout: dto.checkout,
            idEventoSuite: input.resolvedSuite.idEventoSuite,
            observacoes: buildObservacoes(dto, payload),
            adultos,
            criancas,
            hospedes: guests.map((g) => ({
                nome: g.nome,
                tipo: String(g.tipo),
                dataNascimento: g.dataNascimento
                    ? (g.dataNascimento instanceof Date
                          ? g.dataNascimento
                          : new Date(g.dataNascimento)
                      )
                          .toISOString()
                          .slice(0, 10)
                    : null,
                cpf: g.cpf ?? null,
                email: g.email ?? null,
                telefone: g.telefone ?? null,
            })),
        };
    },

    /** Observações seccionadas a partir do staging (sem prefixo técnico). */
    buildObservacoesFromStaging(staging: HospedinReservation): string | null {
        const dto = this.toDtoFromStaging(staging);
        return buildObservacoes(dto, dto.sourcePayload || {});
    },
};

function readPayload(
    row: HospedinReservation
): Record<string, unknown> | null {
    const raw = row.payload_json;
    if (!raw) return null;
    if (typeof raw === 'string') {
        try {
            return asRecord(JSON.parse(raw));
        } catch {
            return null;
        }
    }
    return asRecord(raw);
}

/**
 * Monta observações em seções (sem cabeçalhos técnicos tipo "Hospedin #…").
 * Seções vazias são omitidas.
 */
function buildObservacoes(
    _dto: HospedinReservationDto,
    payload: Record<string, unknown>
): string | null {
    const sections: string[] = [];

    const reservaNote =
        asString(payload.note) ||
        asString(payload.notes) ||
        asString(payload.observation) ||
        asString(payload.observations) ||
        asString(payload.obs) ||
        asString(payload.comment);
    if (reservaNote) {
        sections.push(`Reserva\n${reservaNote.trim()}`);
    }

    const mainGuest =
        asRecord(payload.main_guest) ||
        asRecord(payload.guest) ||
        asRecord(payload.customer) ||
        asRecord(payload.client);
    const guestNote =
        asString(mainGuest?.note) ||
        asString(mainGuest?.notes) ||
        asString(mainGuest?.observation) ||
        asString(mainGuest?.observations);
    if (guestNote) {
        sections.push(`Hóspede\n${guestNote.trim()}`);
    }

    const special =
        asString(payload.special_requests) ||
        asString(payload.special_request) ||
        asString(payload.guest_requests) ||
        asString(payload.pedido_especial) ||
        asString(payload.requests);
    if (special) {
        sections.push(`Pedido especial\n${special.trim()}`);
    }

    const other =
        asString(payload.internal_note) ||
        asString(payload.staff_note) ||
        asString(payload.additional_info);
    if (other) {
        sections.push(`Informações adicionais\n${other.trim()}`);
    }

    if (!sections.length) return null;
    return sections.join('\n\n').slice(0, 4000);
}

function extractGuests(
    payload: Record<string, unknown>
): HospedeCheckoutItem[] {
    const list: HospedeCheckoutItem[] = [];

    const arrays = [
        payload.guests,
        payload.guest_list,
        payload.reservation_guests,
        payload.hospedes,
    ];

    for (const arr of arrays) {
        if (!Array.isArray(arr)) continue;
        for (const raw of arr) {
            const mapped = mapGuestRecord(asRecord(raw));
            if (mapped) list.push(mapped);
        }
        if (list.length) return list;
    }

    const main =
        asRecord(payload.main_guest) ||
        asRecord(payload.guest) ||
        asRecord(payload.customer) ||
        asRecord(payload.client);
    if (main) {
        const mapped = mapGuestRecord(main);
        if (mapped) list.push(mapped);
    }

    // Contadores sem nomes → incompleto (não inventar hóspedes).
    return list;
}

function mapGuestRecord(
    row: Record<string, unknown> | null
): HospedeCheckoutItem | null {
    if (!row) return null;

    const nome =
        asString(row.name) ||
        asString(row.nome) ||
        asString(row.full_name) ||
        [asString(row.first_name), asString(row.last_name)]
            .filter(Boolean)
            .join(' ')
            .trim() ||
        null;

    if (!nome) return null;

    const tipoRaw = (
        asString(row.type) ||
        asString(row.tipo) ||
        asString(row.guest_type) ||
        'adult'
    ).toLowerCase();

    const isChild =
        tipoRaw.includes('child') ||
        tipoRaw.includes('crianca') ||
        tipoRaw.includes('criança') ||
        tipoRaw === 'kid' ||
        row.is_child === true;

    const birth =
        asDate(row.birthdate) ||
        asDate(row.birth_date) ||
        asDate(row.data_nascimento) ||
        asDate(row.dataNascimento) ||
        null;

    if (isChild) {
        return {
            nome,
            tipo: TipoReservaHospede.Crianca,
            dataNascimento: birth,
            ...guestContactFields(row),
        };
    }

    // Idade informada ≤ 12 sem tipo explícito → criança (ainda exige DOB).
    const age = asNumber(row.age) ?? asNumber(row.idade);
    if (age != null && age <= 12) {
        return {
            nome,
            tipo: TipoReservaHospede.Crianca,
            dataNascimento: birth,
            ...guestContactFields(row),
        };
    }

    return {
        nome,
        tipo: TipoReservaHospede.Adulto,
        dataNascimento: birth,
        ...guestContactFields(row),
    };
}

function guestContactFields(row: Record<string, unknown>) {
    const contact = asRecord(row.contact);
        const cpf =
            asString(row.cpf) ||
            asString(row.ssn) ||
            asString(row.documento) ||
            null;
        // identification/passport são documentos — não usar como CPF.
    const email = asString(row.email) || asString(contact.email) || null;
    const telefone =
        asString(row.phone) ||
        asString(row.telefone) ||
        asString(contact.phone) ||
        asString(contact.extra_phone) ||
        null;
    return { cpf, email, telefone };
}
