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

function buildObservacoes(
    dto: HospedinReservationDto,
    payload: Record<string, unknown>
): string | null {
    const parts: string[] = [];
    const code = dto.searchableCode || asString(payload.searchable_code);
    parts.push(
        code
            ? `Hospedin #${code} (id=${dto.reservationId})`
            : `Hospedin id=${dto.reservationId}`
    );

    const notes =
        asString(payload.notes) ||
        asString(payload.observation) ||
        asString(payload.observations) ||
        asString(payload.obs) ||
        asString(payload.comment);
    if (notes) parts.push(notes);

    return parts.join(' — ').slice(0, 2000);
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
        };
    }

    // Idade informada ≤ 12 sem tipo explícito → criança (ainda exige DOB).
    const age = asNumber(row.age) ?? asNumber(row.idade);
    if (age != null && age <= 12) {
        return {
            nome,
            tipo: TipoReservaHospede.Crianca,
            dataNascimento: birth,
        };
    }

    return {
        nome,
        tipo: TipoReservaHospede.Adulto,
        dataNascimento: null,
    };
}
