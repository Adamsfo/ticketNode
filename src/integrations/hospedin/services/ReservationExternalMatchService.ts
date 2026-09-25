import { Op } from 'sequelize';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { placeSuiteResolver } from './PlaceSuiteResolver';

export type HospedinExternalIdentifiers = {
    reservationId: string | number;
    searchableCode?: string | null;
};

export type ExternalReservationMatch = {
    idReservaHospedagem: number;
    origemReserva: string;
    matchedBy: 'id_externo' | 'codigo_externo' | 'hospedin_reservation_id';
};

export type HospedinReservaHospedagemMatchInput = HospedinExternalIdentifiers & {
    /** Hospedin staging place_id — obrigatório para validar fallback por ReservaSuite. */
    placeId?: number | null;
};

export type HospedinReservaHospedagemMatchOutcome =
    | { status: 'matched'; match: ExternalReservationMatch }
    | { status: 'not_found' }
    | {
          status: 'ambiguous_suite_id';
          message: string;
      }
    | {
          status: 'orphan_suite';
          message: string;
      }
    | {
          status: 'place_mismatch';
          message: string;
      };

function normalizeExternalValue(value: unknown): string {
    return String(value ?? '').trim();
}

/**
 * Match apenas no cabeçalho ReservaHospedagem (id_externo / codigo_externo).
 */
export async function findReservaHospedagemHeaderByHospedinIdentifiers(
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

/**
 * Localiza ReservaHospedagem já existente pelos identificadores Hospedin (cabeçalho).
 * Prioridade: id_externo (reservation_id) > codigo_externo (searchable_code).
 * Não consulta ReservaSuite — use {@link resolveHospedinReservaHospedagemMatch} no pipeline.
 */
export async function findReservaHospedagemByHospedinIdentifiers(
    input: HospedinExternalIdentifiers
): Promise<ExternalReservationMatch | null> {
    return findReservaHospedagemHeaderByHospedinIdentifiers(input);
}

async function findReservaHospedagemByHospedinSuiteReservationId(
    reservationId: string,
    placeId: number | null | undefined
): Promise<HospedinReservaHospedagemMatchOutcome> {
    if (!reservationId) {
        return { status: 'not_found' };
    }

    const { ReservaSuite } = await import('../../../models/ReservaSuite');
    const lines = await ReservaSuite.findAll({
        where: { hospedinReservationId: reservationId },
        attributes: ['id', 'idEventoSuite', 'idReservaHospedagem'],
        limit: 2,
    });

    if (lines.length === 0) {
        return { status: 'not_found' };
    }

    if (lines.length > 1) {
        return {
            status: 'ambiguous_suite_id',
            message: `hospedin_reservation_id=${reservationId} aparece em ${lines.length} ReservaSuite — vínculo ambíguo.`,
        };
    }

    const line = lines[0];
    const parentId = Number(line.idReservaHospedagem);
    if (!Number.isFinite(parentId) || parentId <= 0) {
        return {
            status: 'orphan_suite',
            message: `ReservaSuite id=${line.id} sem ReservaHospedagem pai válida.`,
        };
    }

    const hospedagem = await ReservaHospedagem.findByPk(parentId, {
        attributes: ['id', 'origemReserva'],
    });
    if (!hospedagem) {
        return {
            status: 'orphan_suite',
            message: `ReservaSuite id=${line.id} referencia ReservaHospedagem id=${parentId} inexistente.`,
        };
    }

    const placeNum = placeId != null ? Number(placeId) : Number.NaN;
    if (Number.isFinite(placeNum) && placeNum > 0) {
        const resolved = await placeSuiteResolver.resolveInternalSuite(placeNum);
        if (!resolved.found) {
            return {
                status: 'place_mismatch',
                message: `place_id=${placeNum} não mapeado para suíte interna — não vincular por ReservaSuite.`,
            };
        }
        if (
            Number(line.idEventoSuite) !== Number(resolved.idEventoSuite)
        ) {
            return {
                status: 'place_mismatch',
                message: `hospedin_reservation_id=${reservationId} pertence à EventoSuite.id=${line.idEventoSuite}, incompatível com place_id=${placeNum} → EventoSuite.id=${resolved.idEventoSuite}.`,
            };
        }
    }

    return {
        status: 'matched',
        match: {
            idReservaHospedagem: parentId,
            origemReserva: String(hospedagem.origemReserva || ''),
            matchedBy: 'hospedin_reservation_id',
        },
    };
}

/**
 * Identificação centralizada: cabeçalho ReservaHospedagem primeiro; fallback ReservaSuite.hospedin_reservation_id.
 */
export async function resolveHospedinReservaHospedagemMatch(
    input: HospedinReservaHospedagemMatchInput
): Promise<HospedinReservaHospedagemMatchOutcome> {
    const header = await findReservaHospedagemHeaderByHospedinIdentifiers(
        input
    );
    if (header) {
        return { status: 'matched', match: header };
    }

    const reservationId = normalizeExternalValue(input.reservationId);
    if (!reservationId) {
        return { status: 'not_found' };
    }

    return findReservaHospedagemByHospedinSuiteReservationId(
        reservationId,
        input.placeId
    );
}

export function extractHospedinSearchableCode(
    payload: Record<string, unknown> | null | undefined
): string | null {
    if (!payload) return null;
    const code = normalizeExternalValue(payload.searchable_code);
    return code || null;
}

export function extractHospedinPlaceId(
    payload: Record<string, unknown> | null | undefined
): number | null {
    if (!payload) return null;
    const id = Number(payload.place_id);
    return Number.isFinite(id) && id > 0 ? id : null;
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
