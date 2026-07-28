import type { HospedinPlaceDto, InternalHospedinPlace } from '../dto';
import {
    asBoolean,
    asNumber,
    asRecord,
    asString,
} from './mapperHelpers';

/**
 * Converter Place: JSON API → DTO → staging.
 * Sem regra de negócio / sem escrita em EventoSuite.
 */
export const HospedinPlaceMapper = {
    toDto(raw: unknown): HospedinPlaceDto {
        const row = asRecord(raw);
        const placeId = asNumber(row.id);
        if (placeId == null) {
            throw new Error('HospedinPlaceMapper: id ausente.');
        }

        const placeType = asRecord(row.place_type);
        const placeTypeId =
            asNumber(placeType.id) ?? asNumber(row.place_type_id);
        const capacidade =
            asNumber(placeType.occupants) ?? asNumber(row.occupants);

        return {
            placeId,
            placeTypeId,
            nome:
                asString(row.title) ||
                asString(row.name) ||
                `Suíte ${placeId}`,
            capacidade,
            ativo: asBoolean(row.status, true),
            sourcePayload: row,
        };
    },

    toInternal(
        dto: HospedinPlaceDto,
        syncedAt = new Date()
    ): InternalHospedinPlace {
        return {
            place_id: dto.placeId,
            place_type_id: dto.placeTypeId,
            nome: dto.nome,
            capacidade: dto.capacidade,
            ativo: dto.ativo,
            payload_json: dto.sourcePayload,
            synced_at: syncedAt,
        };
    },
};
