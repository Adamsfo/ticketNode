import type { HospedinReservation } from '../../../models/HospedinReservation';
import {
    extractHospedinSearchableCode,
    findReservaHospedagemByHospedinIdentifiers,
    reservaMatchesHospedinExternalIds,
    type ExternalReservationMatch,
} from './ReservationExternalMatchService';

export type ExistingReservationLinkResolution = ExternalReservationMatch & {
    /**
     * true = apenas vincular sync state (origem ≠ HOSPEDIN — preserva dados).
     * false = reserva HOSPEDIN existente — seguir UPDATE no runner.
     */
    linkOnly: boolean;
};

function readPayload(
    staging: HospedinReservation
): Record<string, unknown> | null {
    const raw = staging.payload_json;
    if (!raw) return null;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw) as Record<string, unknown>;
        } catch {
            return null;
        }
    }
    return raw as Record<string, unknown>;
}

/**
 * Resolve vínculo com ReservaHospedagem existente antes de CREATE.
 * Não altera dados da reserva — apenas identifica correspondência.
 */
export async function resolveExistingReservationLink(input: {
    reservationId: number;
    payload?: Record<string, unknown> | null;
    staging?: HospedinReservation | null;
    internalEntityId?: string | null;
}): Promise<ExistingReservationLinkResolution | null> {
    const linkedId = normalizeLinkedId(input.internalEntityId);
    const payload =
        input.payload ??
        (input.staging ? readPayload(input.staging) : null);
    const searchableCode = extractHospedinSearchableCode(payload);

    if (linkedId != null) {
        const { ReservaHospedagem } = await import(
            '../../../models/ReservaHospedagem'
        );
        const reserva = await ReservaHospedagem.findByPk(linkedId, {
            attributes: ['id', 'origemReserva', 'idExterno', 'codigoExterno'],
        });
        if (reserva) {
            const origem = String(reserva.origemReserva || '').toUpperCase();
            const externalMatch = reservaMatchesHospedinExternalIds(reserva, {
                reservationId: input.reservationId,
                searchableCode,
            });
            if (origem !== 'HOSPEDIN' && externalMatch.matched) {
                return {
                    idReservaHospedagem: linkedId,
                    origemReserva: String(reserva.origemReserva || ''),
                    matchedBy: externalMatch.matchedBy || 'id_externo',
                    linkOnly: true,
                };
            }
            if (origem === 'HOSPEDIN' && externalMatch.matched) {
                return {
                    idReservaHospedagem: linkedId,
                    origemReserva: String(reserva.origemReserva || ''),
                    matchedBy: externalMatch.matchedBy || 'id_externo',
                    linkOnly: false,
                };
            }
        }
        return null;
    }

    const match = await findReservaHospedagemByHospedinIdentifiers({
        reservationId: input.reservationId,
        searchableCode,
    });

    if (!match) {
        return null;
    }

    const origem = String(match.origemReserva || '').toUpperCase();
    return {
        ...match,
        linkOnly: origem !== 'HOSPEDIN',
    };
}

function normalizeLinkedId(
    internalEntityId?: string | null
): number | null {
    if (internalEntityId == null || internalEntityId === '') {
        return null;
    }
    const id = Number(internalEntityId);
    if (!Number.isFinite(id) || id <= 0) {
        return null;
    }
    return id;
}
