import {
    hospedinApiClient,
    HospedinApiClient,
} from '../api/HospedinApiClient';
import type { HospedinReservationDto } from '../dto';
import { HospedinLogger } from '../logger/HospedinLogger';
import { asNumber, asRecord, asString } from '../mapper/mapperHelpers';
import { hospedinAuthService, HospedinAuthService } from './HospedinAuthService';
import {
    hospedinReservationService,
    HospedinReservationService,
} from './HospedinReservationService';

export type HospedinGuestDto = {
    guestId: number;
    name: string;
    birth: string | null;
    email: string | null;
    sourcePayload: Record<string, unknown>;
};

/**
 * Indica se o payload já contém ao menos um hóspede com nome.
 * Espelha a expectativa do DomainMapper (sem inventar nomes).
 */
export function payloadHasNamedGuests(
    payload: Record<string, unknown> | null | undefined
): boolean {
    if (!payload || typeof payload !== 'object') return false;

    const arrays = [
        payload.guests,
        payload.guest_list,
        payload.reservation_guests,
        payload.hospedes,
    ];
    for (const arr of arrays) {
        if (!Array.isArray(arr)) continue;
        for (const raw of arr) {
            const row = asRecord(raw);
            if (guestNameFromRecord(row)) return true;
        }
    }

    const main =
        asRecord(payload.main_guest) ||
        asRecord(payload.guest) ||
        asRecord(payload.customer) ||
        asRecord(payload.client);
    return Boolean(guestNameFromRecord(main));
}

function guestNameFromRecord(
    row: Record<string, unknown> | null
): string | null {
    if (!row) return null;
    return (
        asString(row.name) ||
        asString(row.nome) ||
        asString(row.full_name) ||
        [asString(row.first_name), asString(row.last_name)]
            .filter(Boolean)
            .join(' ')
            .trim() ||
        null
    );
}

function isOperationalStatus(status: string | null | undefined): boolean {
    const s = String(status || '').toLowerCase();
    if (!s) return true;
    if (/cancel|no_?show|void|deleted|pre_reservation|waitlist|ignored/.test(s)) {
        return false;
    }
    return true;
}

/**
 * Leitura de Guests na API Hospedin.
 */
export class HospedinGuestService {
    constructor(
        private readonly client: HospedinApiClient = hospedinApiClient,
        private readonly auth: HospedinAuthService = hospedinAuthService
    ) {}

    async getGuestDto(
        guestId: string | number,
        accountId?: string
    ): Promise<HospedinGuestDto> {
        await this.auth.ensureAuthenticated();
        const id = await this.auth.ensureAccountId(accountId);
        const path = `/api/v2/${encodeURIComponent(id)}/guests/${encodeURIComponent(String(guestId))}`;
        const raw = await this.client.get<unknown>(path);
        const row = asRecord(raw);
        const gid = asNumber(row.id) ?? Number(guestId);
        const name = guestNameFromRecord(row);
        if (!name) {
            throw new Error(
                `Hospedin guest_id=${guestId} sem nome no payload.`
            );
        }
        return {
            guestId: gid,
            name,
            birth: asString(row.birth) || asString(row.birthdate) || null,
            email: asString(row.email),
            sourcePayload: row,
        };
    }
}

export const hospedinGuestService = new HospedinGuestService();

/**
 * Se o DTO não tiver hóspedes nomeados:
 * 1) se não houver guest_id (lista resumida), busca GET /reservations/{id};
 * 2) com guest_id, busca GET /guests/{id} e grava main_guest + guests[] no payload.
 *
 * Cache por guest_id evita N chamadas repetidas no mesmo Import.
 */
export async function enrichReservationDtoWithPrimaryGuest(
    dto: HospedinReservationDto,
    options?: {
        accountId?: string;
        guestCache?: Map<number, HospedinGuestDto | null>;
        guestService?: HospedinGuestService;
        reservationService?: HospedinReservationService;
    }
): Promise<{
    dto: HospedinReservationDto;
    enriched: boolean;
    skippedReason?: string;
}> {
    let working = dto;
    let payload = { ...(working.sourcePayload || {}) };

    if (payloadHasNamedGuests(payload)) {
        return { dto: working, enriched: false, skippedReason: 'already_named' };
    }

    let guestId = asNumber(payload.guest_id);
    const reservationService =
        options?.reservationService || hospedinReservationService;

    // Lista da Hospedin costuma omitir guest_id — detalhe traz o campo.
    if (guestId == null || guestId <= 0) {
        if (!isOperationalStatus(working.status)) {
            return {
                dto: working,
                enriched: false,
                skippedReason: 'non_operational_no_guest_id',
            };
        }
        try {
            working = await reservationService.getReservationDto(
                working.reservationId,
                options?.accountId
            );
            payload = { ...(working.sourcePayload || {}) };
            if (payloadHasNamedGuests(payload)) {
                return {
                    dto: working,
                    enriched: false,
                    skippedReason: 'detail_already_named',
                };
            }
            guestId = asNumber(payload.guest_id);
        } catch (err: any) {
            HospedinLogger.warn(
                'guest enrich: detalhe da reserva indisponível',
                {
                    reservation_id: dto.reservationId,
                    message: err?.message,
                }
            );
            return {
                dto,
                enriched: false,
                skippedReason: 'detail_fetch_failed',
            };
        }
    }

    if (guestId == null || guestId <= 0) {
        return { dto: working, enriched: false, skippedReason: 'no_guest_id' };
    }

    const cache = options?.guestCache;
    const service = options?.guestService || hospedinGuestService;

    let guest: HospedinGuestDto | null = null;
    if (cache && cache.has(guestId)) {
        guest = cache.get(guestId) ?? null;
    } else {
        try {
            guest = await service.getGuestDto(guestId, options?.accountId);
            cache?.set(guestId, guest);
        } catch (err: any) {
            cache?.set(guestId, null);
            HospedinLogger.warn('guest enrich falhou; mantém payload original', {
                reservation_id: working.reservationId,
                guest_id: guestId,
                message: err?.message,
            });
            return {
                dto: working,
                enriched: false,
                skippedReason: 'guest_fetch_failed',
            };
        }
    }

    if (!guest) {
        return {
            dto: working,
            enriched: false,
            skippedReason: 'guest_fetch_failed',
        };
    }

    const mainGuest = {
        id: guest.guestId,
        name: guest.name,
        type: 'adult',
        birth: guest.birth,
        email: guest.email,
        cpf:
            guest.sourcePayload?.ssn ||
            guest.sourcePayload?.identification ||
            guest.sourcePayload?.cpf ||
            null,
        ssn: guest.sourcePayload?.ssn ?? null,
        identification: guest.sourcePayload?.identification ?? null,
        phone: guest.sourcePayload?.contact
            ? (guest.sourcePayload.contact as any).phone
            : null,
        contact: guest.sourcePayload?.contact ?? null,
        source: 'hospedin_guests_api',
    };

    const enrichedPayload: Record<string, unknown> = {
        ...payload,
        guest_id: guest.guestId,
        main_guest: mainGuest,
        guests: [mainGuest],
        _jango_guest_enriched: true,
        _jango_guest_enriched_at: new Date().toISOString(),
    };

    HospedinLogger.info('guest enrich ok', {
        reservation_id: working.reservationId,
        guest_id: guest.guestId,
        name: guest.name,
    });

    return {
        dto: {
            ...working,
            sourcePayload: enrichedPayload,
        },
        enriched: true,
    };
}
