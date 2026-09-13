import { logger } from '../../../utils/logger';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaSuite } from '../../../models/ReservaSuite';
import { CustomError } from '../../../utils/customError';
import {
    hospedinReservationService,
    HospedinReservationService,
} from './HospedinReservationService';
import {
    resolveSuiteHospedinReservationId,
    resolveSuitePlaceIdsForLine,
    sortOutboundSuites,
    type OutboundSuiteLine,
} from '../outbound/hospedinOutboundSuiteReservationService';

const log = logger.child('HospedinAdminSuiteTroca');

export function isHospedinOriginReserva(
    origemReserva?: string | null
): boolean {
    return String(origemReserva || '').toUpperCase() === 'HOSPEDIN';
}

export type PushAdminSuiteTrocaInput = {
    reserva: ReservaHospedagem & {
        idExterno?: string | null;
        origemReserva?: string | null;
        ReservaSuite?: Array<
            ReservaSuite & { hospedinReservationId?: string | null }
        >;
    };
    linhaTrocada: ReservaSuite & { hospedinReservationId?: string | null };
    idEventoSuiteOrigem: number;
    idEventoSuiteDestino: number;
};

export type PushAdminSuiteTrocaResult =
    | { patched: true; hospedinReservationId: string }
    | { patched: false; skipped: string };

/**
 * PATCH administrativo de suíte Jango → Hospedin (somente origem HOSPEDIN).
 * Não usa fila outbound geral — exceção cirúrgica para troca de suíte.
 */
export async function pushAdminSuiteTrocaToHospedin(
    params: PushAdminSuiteTrocaInput,
    reservationService: HospedinReservationService = hospedinReservationService
): Promise<PushAdminSuiteTrocaResult> {
    if (!isHospedinOriginReserva(params.reserva.origemReserva)) {
        return { patched: false, skipped: 'NOT_HOSPEDIN_ORIGIN' };
    }

    const suites = sortOutboundSuites(
        (params.reserva.ReservaSuite ?? []) as OutboundSuiteLine[]
    );
    const suiteIndex = suites.findIndex(
        (s) => Number(s.id) === Number(params.linhaTrocada.id)
    );
    if (suiteIndex < 0) {
        throw new CustomError(
            'Linha de suíte não encontrada para sincronizar troca com Hospedin.',
            500,
            ''
        );
    }

    const linhaEfetiva = {
        ...(params.linhaTrocada as OutboundSuiteLine),
        idEventoSuite: params.idEventoSuiteDestino,
    } as OutboundSuiteLine;

    const reservaIdExterno =
        String(params.reserva.idExterno || '').trim() || null;

    const hospedinReservationId = resolveSuiteHospedinReservationId({
        linha: linhaEfetiva,
        suiteIndex,
        suites,
        reservaIdExterno,
        queueReservationId: null,
    });

    if (!hospedinReservationId) {
        log.warn('admin_troca:hospedin_id_missing', {
            idReservaHospedagem: params.reserva.id,
            idReservaSuite: params.linhaTrocada.id,
            idEventoSuiteOrigem: params.idEventoSuiteOrigem,
            idEventoSuiteDestino: params.idEventoSuiteDestino,
        });
        throw new CustomError(
            'Suíte alterada no Jango, mas a linha não possui vínculo Hospedin para sincronização.',
            502,
            'HOSPEDIN_RESERVATION_ID_MISSING'
        );
    }

    const placeContext = await resolveSuitePlaceIdsForLine(linhaEfetiva);
    if (!placeContext.ok) {
        log.warn('admin_troca:place_unmapped', {
            idReservaHospedagem: params.reserva.id,
            idReservaSuite: params.linhaTrocada.id,
            idEventoSuiteDestino: params.idEventoSuiteDestino,
            errorCode: placeContext.errorCode,
        });
        throw new CustomError(
            placeContext.message,
            400,
            placeContext.errorCode
        );
    }

    const patch = {
        place_id: placeContext.placeId,
        place_type_id: placeContext.placeTypeId,
    };

    log.info('admin_troca:patch-reservation', {
        idReservaHospedagem: params.reserva.id,
        idReservaSuite: params.linhaTrocada.id,
        idEventoSuiteOrigem: params.idEventoSuiteOrigem,
        idEventoSuiteDestino: params.idEventoSuiteDestino,
        hospedinReservationId,
        place_id: patch.place_id,
        place_type_id: patch.place_type_id,
    });

    try {
        await reservationService.updateReservation(
            hospedinReservationId,
            patch
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error('admin_troca:patch_failed', {
            idReservaHospedagem: params.reserva.id,
            idReservaSuite: params.linhaTrocada.id,
            hospedinReservationId,
            message,
        });
        throw new CustomError(
            `Suíte alterada no Jango, mas falha ao sincronizar com o Hospedin: ${message}`,
            502,
            'HOSPEDIN_SUITE_PATCH_FAILED'
        );
    }

    log.info('admin_troca:patch_success', {
        idReservaHospedagem: params.reserva.id,
        idReservaSuite: params.linhaTrocada.id,
        hospedinReservationId,
        place_id: patch.place_id,
    });

    return { patched: true, hospedinReservationId };
}
