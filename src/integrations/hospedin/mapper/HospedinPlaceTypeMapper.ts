import type {
    HospedinPlaceTypeDto,
    InternalHospedinPlaceType,
} from '../dto';
import {
    asBoolean,
    asNumber,
    asRecord,
    asString,
} from './mapperHelpers';

/**
 * Converter Place Type: JSON API → DTO → staging.
 * Sem regra de negócio.
 */
export const HospedinPlaceTypeMapper = {
    toDto(raw: unknown): HospedinPlaceTypeDto {
        const row = asRecord(raw);
        const placeTypeId = asNumber(row.id);
        if (placeTypeId == null) {
            throw new Error('HospedinPlaceTypeMapper: id ausente.');
        }

        return {
            placeTypeId,
            nome:
                asString(row.title) ||
                asString(row.name) ||
                `Tipo ${placeTypeId}`,
            capacidade: asNumber(row.occupants),
            ativo: asBoolean(row.status, true),
            sourcePayload: row,
        };
    },

    toInternal(
        dto: HospedinPlaceTypeDto,
        syncedAt = new Date()
    ): InternalHospedinPlaceType {
        return {
            place_type_id: dto.placeTypeId,
            nome: dto.nome,
            capacidade: dto.capacidade,
            payload_json: dto.sourcePayload,
            synced_at: syncedAt,
        };
    },
};
