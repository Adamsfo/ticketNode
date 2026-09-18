import { logger } from '../../../utils/logger';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaSuite } from '../../../models/ReservaSuite';
import { CustomError } from '../../../utils/customError';
import { formatOutboundCheckDatetime } from '../outbound/HospedinOutboundPayloadBuilder';
import {
    collectDistinctHospedinReservationIds,
    sortOutboundSuites,
    type OutboundSuiteLine,
} from '../outbound/hospedinOutboundSuiteReservationService';
import {
    hospedinReservationService,
    HospedinReservationService,
} from './HospedinReservationService';
import { isHospedinOriginReserva } from './hospedinAdminSuiteTrocaPushService';

const log = logger.child('HospedinAdminPeriodoTroca');

export type PushAdminPeriodoTrocaInput = {
    reserva: ReservaHospedagem & {
        idExterno?: string | null;
        origemReserva?: string | null;
        ReservaSuite?: Array<
            ReservaSuite & { hospedinReservationId?: string | null }
        >;
    };
    checkin: Date;
    checkout: Date;
};

export type PushAdminPeriodoTrocaResult =
    | { patched: true; hospedinReservationIds: string[] }
    | { patched: false; skipped: string };

/**
 * PATCH administrativo de período Jango → Hospedin (somente origem HOSPEDIN).
 * Não usa fila outbound geral — exceção cirúrgica para alteração de período.
 */
export async function pushAdminPeriodoTrocaToHospedin(
    params: PushAdminPeriodoTrocaInput,
    reservationService: HospedinReservationService = hospedinReservationService
): Promise<PushAdminPeriodoTrocaResult> {
    if (!isHospedinOriginReserva(params.reserva.origemReserva)) {
        return { patched: false, skipped: 'NOT_HOSPEDIN_ORIGIN' };
    }

    const checkIn = formatOutboundCheckDatetime(params.checkin);
    const checkOut = formatOutboundCheckDatetime(params.checkout);
    if (!checkIn || !checkOut) {
        throw new CustomError(
            'Datas inválidas para sincronizar período com Hospedin.',
            500,
            'HOSPEDIN_PERIODO_DATES_INVALID'
        );
    }

    const suites = sortOutboundSuites(
        (params.reserva.ReservaSuite ?? []) as OutboundSuiteLine[]
    );
    const reservaIdExterno =
        String(params.reserva.idExterno || '').trim() || null;

    const hospedinReservationIds = collectDistinctHospedinReservationIds({
        suites,
        reservaIdExterno,
        queueReservationId: null,
    });

    if (!hospedinReservationIds.length) {
        log.warn('admin_periodo:hospedin_id_missing', {
            idReservaHospedagem: params.reserva.id,
            checkin: checkIn,
            checkout: checkOut,
        });
        throw new CustomError(
            'Período alterado no Jango, mas a reserva não possui vínculo Hospedin para sincronização.',
            502,
            'HOSPEDIN_RESERVATION_ID_MISSING'
        );
    }

    const patch = {
        check_in: checkIn,
        check_out: checkOut,
    };

    log.info('admin_periodo:patch-reservation', {
        idReservaHospedagem: params.reserva.id,
        hospedinReservationIds,
        check_in: patch.check_in,
        check_out: patch.check_out,
    });

    const patchedIds: string[] = [];

    for (const hospedinReservationId of hospedinReservationIds) {
        try {
            await reservationService.updateReservation(
                hospedinReservationId,
                patch
            );
            patchedIds.push(hospedinReservationId);
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : String(error);
            log.error('admin_periodo:patch_failed', {
                idReservaHospedagem: params.reserva.id,
                hospedinReservationId,
                check_in: patch.check_in,
                check_out: patch.check_out,
                message,
            });
            throw new CustomError(
                `Período alterado no Jango, mas falha ao sincronizar com o Hospedin: ${message}`,
                502,
                'HOSPEDIN_PERIODO_PATCH_FAILED'
            );
        }
    }

    log.info('admin_periodo:patch_success', {
        idReservaHospedagem: params.reserva.id,
        hospedinReservationIds: patchedIds,
        check_in: patch.check_in,
        check_out: patch.check_out,
    });

    return { patched: true, hospedinReservationIds: patchedIds };
}
