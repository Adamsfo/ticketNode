import type {
    HospedinReservationDto,
    InternalHospedinReservation,
} from '../dto';
import { asDate, asNumber, asRecord, asString } from './mapperHelpers';

/**
 * Converter Reservation: JSON API → DTO → staging.
 * Sem regra de negócio / sem escrita em ReservaHospedagem.
 */
export const HospedinReservationMapper = {
    toDto(raw: unknown): HospedinReservationDto {
        const row = asRecord(raw);
        const reservationId = asNumber(row.id);
        if (reservationId == null) {
            throw new Error('HospedinReservationMapper: id ausente.');
        }

        return {
            reservationId,
            status: asString(row.status),
            checkin: asDate(row.check_in),
            checkout: asDate(row.check_out),
            searchableCode: asString(row.searchable_code),
            placeId: asNumber(row.place_id),
            placeTypeId: asNumber(row.place_type_id),
            sourcePayload: row,
        };
    },

    toInternal(
        dto: HospedinReservationDto,
        now = new Date(),
        importedAt?: Date
    ): InternalHospedinReservation {
        return {
            reservation_id: dto.reservationId,
            status: dto.status,
            checkin: dto.checkin,
            checkout: dto.checkout,
            payload_json: dto.sourcePayload,
            imported_at: importedAt || now,
            updated_at: now,
        };
    },
};
