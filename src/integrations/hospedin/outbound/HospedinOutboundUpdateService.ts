import { logger } from '../../../utils/logger';
import { HospedinPlace } from '../../../models/HospedinPlace';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundSyncState,
} from '../../../models/HospedinOutboundSyncState';
import { PlaceSuiteMappingStatus } from '../../../models/HospedinPlaceSuiteMap';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaHospede } from '../../../models/ReservaHospede';
import { ReservaSuite } from '../../../models/ReservaSuite';
import { HospedinApiError } from '../types/errors';
import { hospedinPlaceSuiteMapService } from '../services/HospedinPlaceSuiteMapService';
import {
    hospedinReservationService,
    HospedinReservationService,
} from '../services/HospedinReservationService';
import { classifyOutboundHttpError } from './hospedinOutboundErrorClassification';
import {
    buildOutboundUpdatePatch,
    OUTBOUND_CREATE_DEFERRED_STATUS,
    OUTBOUND_CREATE_ELIGIBLE_STATUSES,
    OUTBOUND_CREATE_TERMINAL_STATUSES,
} from './HospedinOutboundPayloadBuilder';
import { hospedinOutboundStateService } from './HospedinOutboundStateService';
import {
    buildSnapshotFromReserva,
    hashOutboundPayload,
    parseSyncedHashInputJson,
    serializeHashInput,
    snapshotToHashInput,
    type OutboundPayloadHashInput,
} from './HospedinOutboundSnapshot';

const log = logger.child('HospedinOutboundUpdate');

/**
 * 409 Conflict não documentado no OpenAPI Hospedin.
 * Decisão conservadora: FAILED permanente (sem retry cego) — operador reconcilia manualmente.
 */
export const OUTBOUND_UPDATE_409_POLICY =
    'HTTP 409 em PATCH /reservations → FAILED (HTTP_409), sem retry automático.';

export type OutboundUpdateOutcome =
    | 'updated'
    | 'idempotent'
    | 'deferred'
    | 'blocked'
    | 'failed'
    | 'retry'
    | 'stale';

export type OutboundUpdateResult = {
    outcome: OutboundUpdateOutcome;
    idReservaHospedagem: number;
    hospedinReservationId?: string | null;
    errorCode?: string | null;
    message?: string | null;
};

export type OutboundUpdateRunOptions = {
    correlationId?: string;
    maxRetries?: number;
    backoffBaseSeconds?: number;
};

type LoadedReserva = ReservaHospedagem & {
    observacaoImportada?: string | null;
    observacaoOperador?: string | null;
    observacoes?: string | null;
    ReservaSuite?: Array<
        ReservaSuite & {
            ReservaHospede?: ReservaHospede[];
        }
    >;
};

/**
 * UPDATE real outbound Jango → Hospedin (PATCH somente — nunca POST).
 */
export class HospedinOutboundUpdateService {
    constructor(
        private readonly reservationService: HospedinReservationService = hospedinReservationService
    ) {}

    async update(
        state: HospedinOutboundSyncState,
        options?: OutboundUpdateRunOptions
    ): Promise<OutboundUpdateResult> {
        const stateId = Number(state.id);
        const idReserva = Number(state.id_reserva_hospedagem);

        const freshState =
            (await HospedinOutboundSyncState.findByPk(stateId)) ?? state;

        const hospedagem = await this.loadReserva(idReserva);
        if (!hospedagem) {
            return this.failPermanent(stateId, idReserva, {
                errorCode: 'RESERVA_NOT_FOUND',
                message: `ReservaHospedagem id=${idReserva} não encontrada.`,
            });
        }

        const status = String(hospedagem.status || '');

        if (OUTBOUND_CREATE_TERMINAL_STATUSES.has(status)) {
            return this.failPermanent(stateId, idReserva, {
                errorCode: 'STATUS_TERMINAL',
                message: `Status ${status} não elegível para UPDATE outbound.`,
            });
        }

        if (status === OUTBOUND_CREATE_DEFERRED_STATUS) {
            await hospedinOutboundStateService.releaseToPending(stateId, {
                desiredAction: HospedinOutboundDesiredAction.UPDATE,
            });
            return {
                outcome: 'deferred',
                idReservaHospedagem: idReserva,
                errorCode: 'AWAITING_PAYMENT',
                message: 'Aguardando pagamento — UPDATE adiado.',
            };
        }

        if (!OUTBOUND_CREATE_ELIGIBLE_STATUSES.has(status)) {
            return this.failPermanent(stateId, idReserva, {
                errorCode: 'STATUS_NOT_ELIGIBLE',
                message: `Status ${status} não permitido para UPDATE outbound.`,
            });
        }

        const hospedinReservationId = this.resolveHospedinReservationId(
            hospedagem,
            freshState
        );
        if (!hospedinReservationId) {
            return this.failPermanent(stateId, idReserva, {
                errorCode: 'HOSPEDIN_ID_MISSING',
                message:
                    'Reserva sem hospedin_reservation_id/idExterno — UPDATE não pode usar POST.',
            });
        }

        const afterInput = snapshotToHashInput(
            buildSnapshotFromReserva(hospedagem)
        );
        const currentHash = hashOutboundPayload(afterInput);
        const payloadHash = String(freshState.payload_hash || '').trim();
        const pendingHash = String(freshState.pending_payload_hash || '').trim();

        if (
            (payloadHash && pendingHash && payloadHash === pendingHash) ||
            (payloadHash && currentHash === payloadHash)
        ) {
            return this.markIdempotent(
                stateId,
                idReserva,
                hospedinReservationId,
                afterInput,
                freshState
            );
        }

        const beforeInput = parseSyncedHashInputJson(
            freshState.synced_hash_input_json
        );
        if (!beforeInput) {
            return this.failPermanent(stateId, idReserva, {
                errorCode: 'SYNC_BASELINE_MISSING',
                message:
                    'Baseline synced_hash_input_json ausente — impossível diff seguro para PATCH.',
            });
        }

        const patchContext = await this.resolveSuitePlaceIds(hospedagem);
        if (!patchContext.ok) {
            return this.block(stateId, idReserva, {
                errorCode: patchContext.errorCode!,
                message: patchContext.message!,
            });
        }

        let patchResult;
        try {
            patchResult = buildOutboundUpdatePatch({
                idReservaHospedagem: idReserva,
                before: beforeInput,
                after: afterInput,
                placeId: patchContext.placeId,
                placeTypeId: patchContext.placeTypeId,
            });
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : String(error);
            return this.block(stateId, idReserva, {
                errorCode: 'PATCH_BUILD_FAILED',
                message,
            });
        }

        const unsupportedOnly =
            patchResult.changedFields.length > 0 &&
            Object.keys(patchResult.patch).length === 0;
        if (unsupportedOnly) {
            return this.block(stateId, idReserva, {
                errorCode: 'UNSUPPORTED_CHANGE',
                message: `Alteração não suportada nesta etapa: ${patchResult.changedFields.join(', ')}`,
            });
        }

        if (Object.keys(patchResult.patch).length === 0) {
            return this.markIdempotent(
                stateId,
                idReserva,
                hospedinReservationId,
                afterInput,
                freshState
            );
        }

        const sentHashInput = this.applyPatchToHashInput(
            beforeInput,
            afterInput,
            patchResult.patch
        );
        const sentHash = hashOutboundPayload(sentHashInput);

        log.info('outbound:update:patch-reservation', {
            correlationId: options?.correlationId,
            idReservaHospedagem: idReserva,
            outboundStateId: stateId,
            hospedinReservationId,
            patchKeys: Object.keys(patchResult.patch),
        });

        try {
            await this.reservationService.updateReservation(
                hospedinReservationId,
                patchResult.patch
            );
        } catch (error: unknown) {
            return this.handleHttpError(freshState, error, options);
        }

        const reloadedState = await HospedinOutboundSyncState.findByPk(stateId);
        const reloadedReserva = await this.loadReserva(idReserva);
        if (!reloadedState || !reloadedReserva) {
            await hospedinOutboundStateService.markFailed(stateId, {
                errorCode: 'RECONCILE_REQUIRED',
                errorMessage:
                    'PATCH Hospedin ok mas falha ao recarregar estado local.',
                hospedinReservationId,
            });
            return {
                outcome: 'failed',
                idReservaHospedagem: idReserva,
                hospedinReservationId,
                errorCode: 'RECONCILE_REQUIRED',
                message: 'PATCH ok — reconciliação manual necessária.',
            };
        }

        const latestInput = snapshotToHashInput(
            buildSnapshotFromReserva(reloadedReserva)
        );
        const latestHash = hashOutboundPayload(latestInput);
        const latestPending = String(
            reloadedState.pending_payload_hash || ''
        ).trim();

        if (latestHash !== latestPending || latestHash !== sentHash) {
            await hospedinOutboundStateService.releaseToPending(stateId, {
                desiredAction: HospedinOutboundDesiredAction.UPDATE,
            });
            log.info('outbound:update:stale-after-patch', {
                correlationId: options?.correlationId,
                idReservaHospedagem: idReserva,
                sentHash,
                latestHash,
                latestPending,
            });
            return {
                outcome: 'stale',
                idReservaHospedagem: idReserva,
                hospedinReservationId,
                message:
                    'Estado Jango mudou durante PATCH — permanece PENDING_UPDATE.',
            };
        }

        try {
            await hospedinOutboundStateService.markSynced(stateId, {
                hospedinReservationId,
                syncedHashInputJson: serializeHashInput(sentHashInput),
            });
        } catch (persistError: unknown) {
            const message =
                persistError instanceof Error
                    ? persistError.message
                    : String(persistError);

            await hospedinOutboundStateService.markFailed(stateId, {
                errorCode: 'RECONCILE_REQUIRED',
                errorMessage: `PATCH Hospedin ok mas falha ao persistir estado: ${message}`,
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

        log.info('outbound:update:success', {
            correlationId: options?.correlationId,
            idReservaHospedagem: idReserva,
            hospedinReservationId,
        });

        return {
            outcome: 'updated',
            idReservaHospedagem: idReserva,
            hospedinReservationId,
        };
    }

    private async loadReserva(idReserva: number): Promise<LoadedReserva | null> {
        return (await ReservaHospedagem.findByPk(idReserva, {
            include: [
                {
                    model: ReservaSuite,
                    as: 'ReservaSuite',
                    include: [
                        {
                            model: ReservaHospede,
                            as: 'ReservaHospede',
                        },
                    ],
                },
            ],
        })) as LoadedReserva | null;
    }

    private resolveHospedinReservationId(
        hospedagem: ReservaHospedagem,
        state: HospedinOutboundSyncState
    ): string | null {
        const idExterno = String(hospedagem.idExterno || '').trim();
        const queueId = String(state.hospedin_reservation_id || '').trim();
        return idExterno || queueId || null;
    }

    private applyPatchToHashInput(
        before: OutboundPayloadHashInput,
        after: OutboundPayloadHashInput,
        patch: ReturnType<typeof buildOutboundUpdatePatch>['patch']
    ): OutboundPayloadHashInput {
        return {
            ...before,
            checkin: patch.check_in ?? before.checkin,
            checkout: patch.check_out ?? before.checkout,
            idEventoSuite:
                patch.place_id != null ? after.idEventoSuite : before.idEventoSuite,
            adultos: patch.adults ?? before.adultos,
            criancas: patch.children ?? before.criancas,
            observacoes:
                patch.note !== undefined ? after.observacoes : before.observacoes,
        };
    }

    private async resolveSuitePlaceIds(hospedagem: LoadedReserva): Promise<
        | {
              ok: true;
              placeId?: number;
              placeTypeId?: number;
          }
        | { ok: false; errorCode: string; message: string }
    > {
        const suites = hospedagem.ReservaSuite ?? [];
        const linha = suites[0];
        if (!linha) {
            return {
                ok: false,
                errorCode: 'SUITE_LINE_MISSING',
                message: 'Reserva sem linha de suíte para outbound.',
            };
        }

        const idEventoSuite = Number(linha.idEventoSuite);
        if (!Number.isFinite(idEventoSuite) || idEventoSuite <= 0) {
            return {
                ok: false,
                errorCode: 'SUITE_UNMAPPED',
                message: 'Suíte da reserva inválida para mapeamento Hospedin.',
            };
        }

        const map =
            await hospedinPlaceSuiteMapService.findByEventoSuiteId(idEventoSuite);
        if (
            !map ||
            !map.ativo ||
            String(map.mapping_status || '').toUpperCase() !==
                PlaceSuiteMappingStatus.LINKED
        ) {
            return {
                ok: false,
                errorCode: 'SUITE_UNMAPPED',
                message: `Suíte id=${idEventoSuite} sem mapeamento Hospedin ativo (LINKED).`,
            };
        }

        const placeId = Number(map.place_id);
        const placeRow = await HospedinPlace.findOne({
            where: { place_id: placeId },
        });
        const placeTypeId = placeRow?.place_type_id
            ? Number(placeRow.place_type_id)
            : null;

        if (!Number.isFinite(placeId) || placeId <= 0) {
            return {
                ok: false,
                errorCode: 'PLACE_INVALID',
                message: 'place_id inválido no mapeamento Hospedin.',
            };
        }

        if (!placeTypeId || !Number.isFinite(placeTypeId) || placeTypeId <= 0) {
            return {
                ok: false,
                errorCode: 'PLACE_TYPE_MISSING',
                message: `place_type_id ausente para place_id=${placeId}.`,
            };
        }

        return { ok: true, placeId, placeTypeId };
    }

    private async markIdempotent(
        stateId: number,
        idReserva: number,
        hospedinReservationId: string,
        afterInput: OutboundPayloadHashInput,
        state: HospedinOutboundSyncState
    ): Promise<OutboundUpdateResult> {
        await hospedinOutboundStateService.markSynced(stateId, {
            hospedinReservationId,
            syncedHashInputJson:
                state.synced_hash_input_json ??
                serializeHashInput(afterInput),
        });

        log.info('outbound:update:idempotent', {
            idReservaHospedagem: idReserva,
            hospedinReservationId,
        });

        return {
            outcome: 'idempotent',
            idReservaHospedagem: idReserva,
            hospedinReservationId,
            message: 'Hashes iguais — PATCH ignorado.',
        };
    }

    private async block(
        stateId: number,
        idReserva: number,
        input: { errorCode: string; message: string }
    ): Promise<OutboundUpdateResult> {
        await hospedinOutboundStateService.markBlocked(stateId, {
            errorCode: input.errorCode,
            errorMessage: input.message,
        });
        return {
            outcome: 'blocked',
            idReservaHospedagem: idReserva,
            errorCode: input.errorCode,
            message: input.message,
        };
    }

    private async failPermanent(
        stateId: number,
        idReserva: number,
        input: { errorCode: string; message: string }
    ): Promise<OutboundUpdateResult> {
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
        options?: OutboundUpdateRunOptions
    ): Promise<OutboundUpdateResult> {
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
                errorCode,
                message,
            };
        }

        await hospedinOutboundStateService.markFailed(stateId, {
            errorCode,
            errorMessage: message,
        });

        return {
            outcome: 'failed',
            idReservaHospedagem: idReserva,
            errorCode,
            message,
        };
    }
}

export const hospedinOutboundUpdateService = new HospedinOutboundUpdateService();
