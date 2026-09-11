import { logger } from '../../../utils/logger';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundSyncState,
} from '../../../models/HospedinOutboundSyncState';
import { ReservaHospedagem, StatusReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaSuite } from '../../../models/ReservaSuite';
import { HospedinApiError } from '../types/errors';
import { isHospedinCancelledStatus } from '../sync/hospedinReservationStatus';
import {
    hospedinReservationService,
    HospedinReservationService,
} from '../services/HospedinReservationService';
import { classifyOutboundHttpError } from './hospedinOutboundErrorClassification';
import { buildOutboundCancelPatch } from './HospedinOutboundPayloadBuilder';
import { hospedinOutboundStateService } from './HospedinOutboundStateService';
import {
    collectDistinctHospedinReservationIds,
    sortOutboundSuites,
    type OutboundSuiteLine,
} from './hospedinOutboundSuiteReservationService';

const log = logger.child('HospedinOutboundCancel');

export type OutboundCancelOutcome =
    | 'cancelled'
    | 'idempotent'
    | 'aborted'
    | 'failed'
    | 'retry';

export type OutboundCancelResult = {
    outcome: OutboundCancelOutcome;
    idReservaHospedagem: number;
    hospedinReservationId?: string | null;
    errorCode?: string | null;
    message?: string | null;
};

export type OutboundCancelRunOptions = {
    correlationId?: string;
    maxRetries?: number;
    backoffBaseSeconds?: number;
};

type LoadedReserva = ReservaHospedagem & {
    ReservaSuite?: OutboundSuiteLine[];
};

/**
 * CANCEL real outbound Jango → Hospedin (PATCH { status: "canceled" } por suíte).
 */
export class HospedinOutboundCancelService {
    constructor(
        private readonly reservationService: HospedinReservationService = hospedinReservationService
    ) {}

    async cancel(
        state: HospedinOutboundSyncState,
        options?: OutboundCancelRunOptions
    ): Promise<OutboundCancelResult> {
        const stateId = Number(state.id);
        const idReserva = Number(state.id_reserva_hospedagem);

        const hospedagem = await this.loadReserva(idReserva);
        if (!hospedagem) {
            return this.failPermanent(stateId, idReserva, {
                errorCode: 'RESERVA_NOT_FOUND',
                message: `ReservaHospedagem id=${idReserva} não encontrada.`,
            });
        }

        if (hospedagem.status !== StatusReservaHospedagem.Cancelada) {
            await hospedinOutboundStateService.releaseToPending(stateId, {
                desiredAction: HospedinOutboundDesiredAction.CANCEL,
            });
            return {
                outcome: 'aborted',
                idReservaHospedagem: idReserva,
                errorCode: 'JANGO_NOT_CANCELLED',
                message: 'Reserva Jango não está Cancelada — cancelamento outbound adiado.',
            };
        }

        const freshState =
            (await HospedinOutboundSyncState.findByPk(stateId)) ?? state;

        const suites = sortOutboundSuites(hospedagem.ReservaSuite ?? []);
        const reservaIdExterno =
            String(hospedagem.idExterno || '').trim() || null;
        const queueReservationId =
            String(freshState.hospedin_reservation_id || '').trim() || null;

        const reservationIds = collectDistinctHospedinReservationIds({
            suites,
            reservaIdExterno,
            queueReservationId,
        });

        if (!reservationIds.length) {
            await hospedinOutboundStateService.markAborted(stateId, {
                errorCode: 'HOSPEDIN_ID_MISSING',
                errorMessage:
                    'Reserva sem hospedin_reservation_id — cancelamento outbound abortado (sem POST).',
            });
            return {
                outcome: 'aborted',
                idReservaHospedagem: idReserva,
                errorCode: 'HOSPEDIN_ID_MISSING',
                message: 'Sem vínculo Hospedin — CREATE abortado.',
            };
        }

        const primaryReservationId = reservationIds[0];
        let anyPatched = false;
        const patch = buildOutboundCancelPatch();

        for (const hospedinReservationId of reservationIds) {
            let remoteStatus: string | null = null;
            try {
                const remote = await this.reservationService.getReservationDto(
                    hospedinReservationId
                );
                remoteStatus = String(remote.status || '');
            } catch (error: unknown) {
                return this.handleHttpError(freshState, error, options, {
                    hospedinReservationId,
                });
            }

            if (isHospedinCancelledStatus(remoteStatus)) {
                log.info('outbound:cancel:already-cancelled', {
                    correlationId: options?.correlationId,
                    idReservaHospedagem: idReserva,
                    outboundStateId: stateId,
                    hospedinReservationId,
                });
                continue;
            }

            log.info('outbound:cancel:patch-reservation', {
                correlationId: options?.correlationId,
                idReservaHospedagem: idReserva,
                outboundStateId: stateId,
                hospedinReservationId,
                patchKeys: Object.keys(patch),
            });

            try {
                const patched = await this.reservationService.cancelReservation(
                    hospedinReservationId,
                    patch
                );
                if (!isHospedinCancelledStatus(patched.status)) {
                    await hospedinOutboundStateService.markFailed(stateId, {
                        errorCode: 'CANCEL_NOT_CONFIRMED',
                        errorMessage: `PATCH ok mas status remoto inesperado: ${patched.status}`,
                        hospedinReservationId,
                    });
                    return {
                        outcome: 'failed',
                        idReservaHospedagem: idReserva,
                        hospedinReservationId,
                        errorCode: 'CANCEL_NOT_CONFIRMED',
                        message: `Status Hospedin após PATCH: ${patched.status}`,
                    };
                }
            } catch (error: unknown) {
                return this.handleHttpError(freshState, error, options, {
                    hospedinReservationId,
                });
            }

            anyPatched = true;
        }

        const reloaded = await ReservaHospedagem.findByPk(idReserva);
        if (!reloaded || reloaded.status !== StatusReservaHospedagem.Cancelada) {
            await hospedinOutboundStateService.markPendingCancel(stateId);
            return {
                outcome: 'aborted',
                idReservaHospedagem: idReserva,
                hospedinReservationId: primaryReservationId,
                message:
                    'PATCH Hospedin ok mas Jango deixou de estar Cancelada — reenfileirado.',
            };
        }

        try {
            await hospedinOutboundStateService.markSynced(stateId, {
                hospedinReservationId: primaryReservationId,
                hospedinGuestId: freshState.hospedin_guest_id,
            });
        } catch (persistError: unknown) {
            const message =
                persistError instanceof Error
                    ? persistError.message
                    : String(persistError);
            await hospedinOutboundStateService.markFailed(stateId, {
                errorCode: 'RECONCILE_REQUIRED',
                errorMessage: `PATCH cancel Hospedin ok mas falha ao persistir: ${message}`,
                hospedinReservationId: primaryReservationId,
            });
            return {
                outcome: 'failed',
                idReservaHospedagem: idReserva,
                hospedinReservationId: primaryReservationId,
                errorCode: 'RECONCILE_REQUIRED',
                message,
            };
        }

        if (anyPatched) {
            log.info('outbound:cancel:success', {
                correlationId: options?.correlationId,
                idReservaHospedagem: idReserva,
                hospedinReservationId: primaryReservationId,
                reservationCount: reservationIds.length,
            });

            return {
                outcome: 'cancelled',
                idReservaHospedagem: idReserva,
                hospedinReservationId: primaryReservationId,
            };
        }

        log.info('outbound:cancel:idempotent', {
            idReservaHospedagem: idReserva,
            hospedinReservationId: primaryReservationId,
            reservationCount: reservationIds.length,
        });

        return {
            outcome: 'idempotent',
            idReservaHospedagem: idReserva,
            hospedinReservationId: primaryReservationId,
            message: 'Hospedin já cancelado — PATCH ignorado.',
        };
    }

    private async loadReserva(idReserva: number): Promise<LoadedReserva | null> {
        return (await ReservaHospedagem.findByPk(idReserva, {
            include: [
                {
                    model: ReservaSuite,
                    as: 'ReservaSuite',
                },
            ],
        })) as LoadedReserva | null;
    }

    private async failPermanent(
        stateId: number,
        idReserva: number,
        input: { errorCode: string; message: string }
    ): Promise<OutboundCancelResult> {
        await hospedinOutboundStateService.markFailed(stateId, {
            errorCode: input.errorCode,
            errorMessage: input.message,
        });
        return {
            outcome: 'failed',
            idReservaHospedagem: idReserva,
            errorCode: input.errorCode,
            message: input.message,
        };
    }

    private async handleHttpError(
        state: HospedinOutboundSyncState,
        error: unknown,
        options?: OutboundCancelRunOptions,
        context?: { hospedinReservationId?: string | null }
    ): Promise<OutboundCancelResult> {
        const message = error instanceof Error ? error.message : String(error);
        let { retryable, errorCode } = classifyOutboundHttpError(error);

        if (error instanceof HospedinApiError && error.status === 404) {
            retryable = false;
            errorCode = 'RESERVATION_NOT_FOUND';
        }

        const stateId = Number(state.id);
        const idReserva = Number(state.id_reserva_hospedagem);
        const maxRetries = Math.max(0, Number(options?.maxRetries ?? 5));
        const backoffBaseSeconds = Math.max(
            1,
            Number(options?.backoffBaseSeconds ?? 30)
        );
        const nextRetryCount = Number(state.retry_count || 0) + 1;
        const hospedinReservationId =
            context?.hospedinReservationId ??
            state.hospedin_reservation_id ??
            null;

        if (retryable && nextRetryCount <= maxRetries) {
            await hospedinOutboundStateService.markWaitRetry(stateId, {
                errorMessage: message,
                errorCode,
                retryCount: nextRetryCount,
                backoffBaseSeconds,
            });
            return {
                outcome: 'retry',
                idReservaHospedagem: idReserva,
                hospedinReservationId,
                errorCode,
                message,
            };
        }

        await hospedinOutboundStateService.markFailed(stateId, {
            errorCode,
            errorMessage: message,
            hospedinReservationId,
        });

        return {
            outcome: 'failed',
            idReservaHospedagem: idReserva,
            hospedinReservationId,
            errorCode,
            message,
        };
    }
}

export const hospedinOutboundCancelService = new HospedinOutboundCancelService();
