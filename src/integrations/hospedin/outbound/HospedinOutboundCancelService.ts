import { logger } from '../../../utils/logger';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundSyncState,
} from '../../../models/HospedinOutboundSyncState';
import { ReservaHospedagem, StatusReservaHospedagem } from '../../../models/ReservaHospedagem';
import { HospedinApiError } from '../types/errors';
import { isHospedinCancelledStatus } from '../sync/hospedinReservationStatus';
import {
    hospedinReservationService,
    HospedinReservationService,
} from '../services/HospedinReservationService';
import { classifyOutboundHttpError } from './hospedinOutboundErrorClassification';
import { buildOutboundCancelPatch } from './HospedinOutboundPayloadBuilder';
import { hospedinOutboundStateService } from './HospedinOutboundStateService';

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

/**
 * CANCEL real outbound Jango → Hospedin (PATCH { status: "canceled" }).
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

        const hospedagem = await ReservaHospedagem.findByPk(idReserva);
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

        const hospedinReservationId = this.resolveHospedinReservationId(
            hospedagem,
            freshState
        );
        if (!hospedinReservationId) {
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
            return this.markIdempotent(
                stateId,
                idReserva,
                hospedinReservationId,
                freshState
            );
        }

        const patch = buildOutboundCancelPatch();

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

        const reloaded = await ReservaHospedagem.findByPk(idReserva);
        if (!reloaded || reloaded.status !== StatusReservaHospedagem.Cancelada) {
            await hospedinOutboundStateService.markPendingCancel(stateId);
            return {
                outcome: 'aborted',
                idReservaHospedagem: idReserva,
                hospedinReservationId,
                message:
                    'PATCH Hospedin ok mas Jango deixou de estar Cancelada — reenfileirado.',
            };
        }

        try {
            await hospedinOutboundStateService.markSynced(stateId, {
                hospedinReservationId,
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
                hospedinReservationId,
            });
            return {
                outcome: 'failed',
                idReservaHospedagem: idReserva,
                hospedinReservationId,
                errorCode: 'RECONCILE_REQUIRED',
                message,
            };
        }

        log.info('outbound:cancel:success', {
            correlationId: options?.correlationId,
            idReservaHospedagem: idReserva,
            hospedinReservationId,
        });

        return {
            outcome: 'cancelled',
            idReservaHospedagem: idReserva,
            hospedinReservationId,
        };
    }

    private resolveHospedinReservationId(
        hospedagem: ReservaHospedagem,
        state: HospedinOutboundSyncState
    ): string | null {
        const idExterno = String(hospedagem.idExterno || '').trim();
        const queueId = String(state.hospedin_reservation_id || '').trim();
        return idExterno || queueId || null;
    }

    private async markIdempotent(
        stateId: number,
        idReserva: number,
        hospedinReservationId: string,
        state: HospedinOutboundSyncState
    ): Promise<OutboundCancelResult> {
        await hospedinOutboundStateService.markSynced(stateId, {
            hospedinReservationId,
            hospedinGuestId: state.hospedin_guest_id,
        });

        log.info('outbound:cancel:idempotent', {
            idReservaHospedagem: idReserva,
            hospedinReservationId,
        });

        return {
            outcome: 'idempotent',
            idReservaHospedagem: idReserva,
            hospedinReservationId,
            message: 'Hospedin já cancelado — PATCH ignorado.',
        };
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
        const maxRetries = Math.max(0, Number(options?.maxRetries) ?? 5);
        const backoffBaseSeconds = Math.max(
            1,
            Number(options?.backoffBaseSeconds) ?? 30
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
