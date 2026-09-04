import { Op } from 'sequelize';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';

export type HospedinExternalIdentifiers = {
    reservationId: string | number;
    searchableCode?: string | null;
};

export type ExternalReservationMatch = {
    idReservaHospedagem: number;
    origemReserva: string;
    matchedBy: 'id_externo' | 'codigo_externo';
};

function normalizeExternalValue(value: unknown): string {
    return String(value ?? '').trim();
}

/**
 * Localiza ReservaHospedagem já existente pelos identificadores Hospedin.
 * Prioridade: id_externo (reservation_id) > codigo_externo (searchable_code).
 */
export async function findReservaHospedagemByHospedinIdentifiers(
    input: HospedinExternalIdentifiers
): Promise<ExternalReservationMatch | null> {
    const reservationId = normalizeExternalValue(input.reservationId);
    const searchableCode = normalizeExternalValue(input.searchableCode);

    if (!reservationId && !searchableCode) {
        return null;
    }

    const orConditions: Record<string, string>[] = [];
    if (reservationId) {
        orConditions.push({ idExterno: reservationId });
    }
    if (searchableCode) {
        orConditions.push({ codigoExterno: searchableCode });
    }

    const rows = await ReservaHospedagem.findAll({
        where: { [Op.or]: orConditions },
        attributes: ['id', 'origemReserva', 'idExterno', 'codigoExterno'],
        order: [['id', 'DESC']],
        limit: 10,
    });

    if (rows.length === 0) {
        return null;
    }

    if (reservationId) {
        const byId = rows.find(
            (row) => normalizeExternalValue(row.idExterno) === reservationId
        );
        if (byId) {
            return {
                idReservaHospedagem: Number(byId.id),
                origemReserva: String(byId.origemReserva || ''),
                matchedBy: 'id_externo',
            };
        }
    }

    if (searchableCode) {
        const byCode = rows.find(
            (row) =>
                normalizeExternalValue(row.codigoExterno) === searchableCode
        );
        if (byCode) {
            return {
                idReservaHospedagem: Number(byCode.id),
                origemReserva: String(byCode.origemReserva || ''),
                matchedBy: 'codigo_externo',
            };
        }
    }

    return null;
}

export function extractHospedinSearchableCode(
    payload: Record<string, unknown> | null | undefined
): string | null {
    if (!payload) return null;
    const code = normalizeExternalValue(payload.searchable_code);
    return code || null;
}

/**
 * Verifica se a ReservaHospedagem corresponde aos identificadores Hospedin informados.
 */
export function reservaMatchesHospedinExternalIds(
    reserva: {
        idExterno?: string | null;
        codigoExterno?: string | null;
    },
    input: HospedinExternalIdentifiers
): { matched: boolean; matchedBy?: 'id_externo' | 'codigo_externo' } {
    const reservationId = normalizeExternalValue(input.reservationId);
    const searchableCode = normalizeExternalValue(input.searchableCode);
    const idExterno = normalizeExternalValue(reserva.idExterno);
    const codigoExterno = normalizeExternalValue(reserva.codigoExterno);

    if (reservationId && idExterno && idExterno === reservationId) {
        return { matched: true, matchedBy: 'id_externo' };
    }
    if (searchableCode && codigoExterno && codigoExterno === searchableCode) {
        return { matched: true, matchedBy: 'codigo_externo' };
    }
    return { matched: false };
}
