import { logger } from '../../../utils/logger';
import { Evento } from '../../../models/Evento';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundSyncState,
} from '../../../models/HospedinOutboundSyncState';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaHospede } from '../../../models/ReservaHospede';
import { ReservaSuite } from '../../../models/ReservaSuite';
import { HospedinApiError } from '../types/errors';
import {
    hospedinReservationService,
    HospedinReservationService,
} from '../services/HospedinReservationService';
import { classifyOutboundHttpError } from './hospedinOutboundErrorClassification';
import {
    buildSharedOutboundUpdatePatch,
    buildSuiteOutboundUpdatePatch,
    isNoteOnlyOperationalPatch,
    mergeOutboundPatches,
    OUTBOUND_CREATE_DEFERRED_STATUS,
    OUTBOUND_CREATE_ELIGIBLE_STATUSES,
    OUTBOUND_CREATE_TERMINAL_STATUSES,
} from './HospedinOutboundPayloadBuilder';
import { hospedinOutboundStateService } from './HospedinOutboundStateService';
import {
    buildSaleSyncContextFromSuite,
    hospedinOutboundSaleSyncService,
    HospedinOutboundSaleSyncService,
} from './HospedinOutboundSaleSyncService';
import {
    anySuiteFinanceChanged,
    applySharedPatchToBaseline,
    applySuitePatchToBaseline,
    buildSyncBaselineFromReserva,
    hashOutboundPayload,
    parseSyncedHashInputJson,
    resolveBeforeSuiteInBaseline,
    serializeHashInput,
    suiteFinanceChanged,
    type OutboundPayloadHashInput,
} from './HospedinOutboundSnapshot';
import {
    hospedinOutboundSuiteReservationService,
    HospedinOutboundSuiteReservationService,
    resolveReservaTitularGuestId,
    resolveSuiteHospedinReservationId,
    resolveSuitePlaceIdsForLine,
    sortOutboundSuites,
    type LoadedReservaForSuite,
    type OutboundSuiteLine,
} from './hospedinOutboundSuiteReservationService';

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

type LoadedReserva = LoadedReservaForSuite & {
    observacaoOperador?: string | null;
    origemReserva?: string | null;
    Evento?: { tipo?: string | null } | null;
    ReservaSuite?: Array<
        OutboundSuiteLine & {
            ReservaHospede?: ReservaHospede[];
        }
    >;
};

/**
 * UPDATE outbound Jango → Hospedin (PATCH por suíte + CREATE idempotente para suítes sem ID).
 */
export class HospedinOutboundUpdateService {
    constructor(
        private readonly reservationService: HospedinReservationService = hospedinReservationService,
        private readonly saleSyncService: HospedinOutboundSaleSyncService = hospedinOutboundSaleSyncService,
        private readonly suiteReservationService: HospedinOutboundSuiteReservationService = hospedinOutboundSuiteReservationService
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

        const suites = sortOutboundSuites(hospedagem.ReservaSuite ?? []);
        if (!suites.length) {
            return this.block(stateId, idReserva, {
                errorCode: 'SUITE_LINE_MISSING',
                message: 'Reserva sem linha de suíte para outbound.',
            });
        }

        const afterInput = buildSyncBaselineFromReserva(hospedagem);
        const currentHash = hashOutboundPayload(afterInput);
        const payloadHash = String(freshState.payload_hash || '').trim();
        const pendingHash = String(freshState.pending_payload_hash || '').trim();

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

        const reservaIdExterno =
            String(hospedagem.idExterno || '').trim() || null;
        const queueReservationId = String(
            freshState.hospedin_reservation_id || ''
        ).trim() || null;

        const financeChanged = anySuiteFinanceChanged(beforeInput, afterInput);
        const sharedPatch = buildSharedOutboundUpdatePatch({
            idReservaHospedagem: idReserva,
            before: beforeInput,
            after: afterInput,
        });
        const sharedOperationalChanged =
            Object.keys(sharedPatch).length > 0;
        const sharedNoteOnly =
            sharedOperationalChanged &&
            isNoteOnlyOperationalPatch(sharedPatch);
        const shouldApplySharedPatch =
            sharedOperationalChanged &&
            !(financeChanged && sharedNoteOnly);

        let suiteOperationalChanged = false;
        for (const afterSuite of afterInput.suites) {
            const beforeSuite = resolveBeforeSuiteInBaseline(
                beforeInput,
                afterSuite,
                suites.length
            );
            try {
                const suitePatch = buildSuiteOutboundUpdatePatch({
                    beforeSuite,
                    afterSuite,
                });
                if (Object.keys(suitePatch).length > 0) {
                    suiteOperationalChanged = true;
                }
            } catch (error: unknown) {
                const message =
                    error instanceof Error ? error.message : String(error);
                return this.block(stateId, idReserva, {
                    errorCode: 'PATCH_BUILD_FAILED',
                    message,
                });
            }
        }

        const suitesMissingReservation = suites.filter(
            (linha, suiteIndex) =>
                !resolveSuiteHospedinReservationId({
                    linha,
                    suiteIndex,
                    suites,
                    reservaIdExterno,
                    queueReservationId,
                })
        );

        const operationalChanged =
            sharedOperationalChanged ||
            suiteOperationalChanged ||
            suitesMissingReservation.length > 0;

        const shouldApplyAnyOperationalPatch =
            (shouldApplySharedPatch && sharedOperationalChanged) ||
            suiteOperationalChanged;

        const primaryReservationId = this.resolvePrimaryHospedinReservationId(
            suites,
            reservaIdExterno,
            queueReservationId
        );

        if (
            (payloadHash && pendingHash && payloadHash === pendingHash) ||
            (payloadHash &&
                currentHash === payloadHash &&
                !financeChanged &&
                !shouldApplyAnyOperationalPatch &&
                suitesMissingReservation.length === 0)
        ) {
            return this.markIdempotent(
                stateId,
                idReserva,
                primaryReservationId,
                afterInput,
                freshState
            );
        }

        if (
            !shouldApplyAnyOperationalPatch &&
            !financeChanged &&
            suitesMissingReservation.length === 0
        ) {
            return this.markIdempotent(
                stateId,
                idReserva,
                primaryReservationId,
                afterInput,
                freshState
            );
        }

        let sentHashInput = { ...beforeInput };
        let reservaTitularGuestId: number | null = null;

        if (suitesMissingReservation.length > 0) {
            try {
                reservaTitularGuestId = await resolveReservaTitularGuestId({
                    outboundStateId: stateId,
                    stateRow: freshState,
                    hospedagem,
                    suites,
                });
            } catch (error: unknown) {
                const message =
                    error instanceof Error ? error.message : String(error);
                return this.block(stateId, idReserva, {
                    errorCode: 'GUEST_NAME_MISSING',
                    message,
                });
            }

            for (let suiteIndex = 0; suiteIndex < suites.length; suiteIndex++) {
                const linha = suites[suiteIndex];
                const existingId = resolveSuiteHospedinReservationId({
                    linha,
                    suiteIndex,
                    suites,
                    reservaIdExterno,
                    queueReservationId,
                });
                if (existingId) {
                    continue;
                }

                const ensureResult =
                    await this.suiteReservationService.ensureSuiteReservation({
                        linha,
                        suiteIndex,
                        suites,
                        hospedagem,
                        idReserva,
                        stateId,
                        reservaTitularGuestId,
                        reservaIdExterno,
                        queueReservationId,
                        correlationId: options?.correlationId,
                        logContext: 'update',
                    });

                if (!ensureResult.ok) {
                    return this.block(stateId, idReserva, {
                        errorCode: ensureResult.errorCode,
                        message: ensureResult.message,
                    });
                }

                if (ensureResult.result.wasCreated) {
                    await hospedinOutboundStateService.persistHospedinIds(
                        stateId,
                        {
                            hospedinReservationId:
                                ensureResult.result.reservationId,
                            hospedinGuestId: ensureResult.result.guestId,
                        }
                    );
                }

                const afterSuite = afterInput.suites.find(
                    (suite) => suite.idReservaSuite === Number(linha.id)
                );
                if (
                    afterSuite &&
                    this.saleSyncService.shouldSyncSale(hospedagem)
                ) {
                    try {
                        await this.saleSyncService.replaceSale(
                            buildSaleSyncContextFromSuite(
                                hospedagem,
                                linha,
                                ensureResult.result.reservationId,
                                options?.correlationId
                            )
                        );
                    } catch (error: unknown) {
                        return this.handleHttpError(
                            freshState,
                            error,
                            options
                        );
                    }
                }
            }
        }

        const saleSyncEnabled = this.saleSyncService.shouldSyncSale(hospedagem);

        for (let suiteIndex = 0; suiteIndex < suites.length; suiteIndex++) {
            const linha = suites[suiteIndex];
            const afterSuite = afterInput.suites.find(
                (suite) => suite.idReservaSuite === Number(linha.id)
            );
            if (!afterSuite) {
                continue;
            }

            const hospedinReservationId = resolveSuiteHospedinReservationId({
                linha,
                suiteIndex,
                suites,
                reservaIdExterno,
                queueReservationId,
            });
            if (!hospedinReservationId) {
                continue;
            }

            const beforeSuite = resolveBeforeSuiteInBaseline(
                beforeInput,
                afterSuite,
                suites.length
            );

            let suitePatch: ReturnType<typeof buildSuiteOutboundUpdatePatch> =
                {};
            try {
                const placeContext = await resolveSuitePlaceIdsForLine(linha);
                suitePatch = buildSuiteOutboundUpdatePatch({
                    beforeSuite,
                    afterSuite,
                    placeId: placeContext.ok
                        ? placeContext.placeId
                        : undefined,
                    placeTypeId: placeContext.ok
                        ? placeContext.placeTypeId
                        : undefined,
                });
            } catch (error: unknown) {
                const message =
                    error instanceof Error ? error.message : String(error);
                return this.block(stateId, idReserva, {
                    errorCode: 'PATCH_BUILD_FAILED',
                    message,
                });
            }

            const combinedPatch = mergeOutboundPatches(
                shouldApplySharedPatch ? sharedPatch : {},
                suitePatch
            );

            if (Object.keys(combinedPatch).length > 0) {
                if (suitePatch.place_id != null) {
                    const placeCheck = await resolveSuitePlaceIdsForLine(linha);
                    if (!placeCheck.ok) {
                        return this.block(stateId, idReserva, {
                            errorCode: placeCheck.errorCode,
                            message: placeCheck.message,
                        });
                    }
                }

                log.info('outbound:update:patch-reservation', {
                    correlationId: options?.correlationId,
                    idReservaHospedagem: idReserva,
                    idReservaSuite: linha.id,
                    outboundStateId: stateId,
                    hospedinReservationId,
                    patchKeys: Object.keys(combinedPatch),
                });

                try {
                    await this.reservationService.updateReservation(
                        hospedinReservationId,
                        combinedPatch
                    );
                } catch (error: unknown) {
                    return this.handleHttpError(freshState, error, options);
                }

                if (shouldApplySharedPatch && sharedOperationalChanged) {
                    sentHashInput = applySharedPatchToBaseline(
                        sentHashInput,
                        afterInput,
                        sharedPatch
                    );
                }
                if (Object.keys(suitePatch).length > 0) {
                    sentHashInput = applySuitePatchToBaseline(
                        sentHashInput,
                        afterSuite.idReservaSuite,
                        afterSuite,
                        suitePatch
                    );
                }

                const staleResult = await this.verifyNotStaleAfterStep({
                    stateId,
                    idReserva,
                    sentHashInput,
                    hospedinReservationId,
                    options,
                });
                if (staleResult) {
                    return staleResult;
                }
            }

            const suiteFinance = suiteFinanceChanged(beforeSuite, afterSuite);
            if (suiteFinance && saleSyncEnabled) {
                try {
                    await this.saleSyncService.replaceSale(
                        buildSaleSyncContextFromSuite(
                            hospedagem,
                            linha,
                            hospedinReservationId,
                            options?.correlationId
                        )
                    );
                } catch (error: unknown) {
                    return this.handleHttpError(freshState, error, options);
                }

            }
        }

        sentHashInput = afterInput;
        const appliedPayloadHash = hashOutboundPayload(sentHashInput);
        const finalPrimaryId = this.resolvePrimaryHospedinReservationId(
            suites,
            reservaIdExterno,
            queueReservationId
        );

        try {
            const finalizeOutcome =
                await hospedinOutboundStateService.markSynced(stateId, {
                    hospedinReservationId: finalPrimaryId,
                    syncedHashInputJson: serializeHashInput(sentHashInput),
                    appliedPayloadHash,
                });

            if (finalizeOutcome === 'pending_again') {
                log.info('outbound:update:pending-again-after-sync', {
                    correlationId: options?.correlationId,
                    idReservaHospedagem: idReserva,
                    hospedinReservationId: finalPrimaryId,
                    appliedPayloadHash,
                });
                return {
                    outcome: 'stale',
                    idReservaHospedagem: idReserva,
                    hospedinReservationId: finalPrimaryId,
                    message:
                        'Sync parcial concluída — pending mais recente enfileirado.',
                };
            }
        } catch (persistError: unknown) {
            const message =
                persistError instanceof Error
                    ? persistError.message
                    : String(persistError);

            await hospedinOutboundStateService.markFailed(stateId, {
                errorCode: 'RECONCILE_REQUIRED',
                errorMessage: `Sync outbound ok mas falha ao persistir estado: ${message}`,
                hospedinReservationId: finalPrimaryId,
            });

            return {
                outcome: 'failed',
                idReservaHospedagem: idReserva,
                hospedinReservationId: finalPrimaryId,
                errorCode: 'RECONCILE_REQUIRED',
                message,
            };
        }

        log.info('outbound:update:success', {
            correlationId: options?.correlationId,
            idReservaHospedagem: idReserva,
            hospedinReservationId: finalPrimaryId,
            operationalChanged,
            financeChanged,
            suiteCount: suites.length,
        });

        return {
            outcome: 'updated',
            idReservaHospedagem: idReserva,
            hospedinReservationId: finalPrimaryId,
        };
    }

    private async loadReserva(idReserva: number): Promise<LoadedReserva | null> {
        return (await ReservaHospedagem.findByPk(idReserva, {
            include: [
                {
                    model: Evento,
                    as: 'Evento',
                    attributes: ['id', 'tipo'],
                    required: false,
                },
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

    private resolvePrimaryHospedinReservationId(
        suites: OutboundSuiteLine[],
        reservaIdExterno: string | null,
        queueReservationId: string | null
    ): string | null {
        for (let suiteIndex = 0; suiteIndex < suites.length; suiteIndex++) {
            const id = resolveSuiteHospedinReservationId({
                linha: suites[suiteIndex],
                suiteIndex,
                suites,
                reservaIdExterno,
                queueReservationId,
            });
            if (id) {
                return id;
            }
        }
        return reservaIdExterno || queueReservationId || null;
    }

    private async verifyNotStaleAfterStep(input: {
        stateId: number;
        idReserva: number;
        sentHashInput: OutboundPayloadHashInput;
        hospedinReservationId: string;
        options?: OutboundUpdateRunOptions;
    }): Promise<OutboundUpdateResult | null> {
        const reloadedState = await HospedinOutboundSyncState.findByPk(
            input.stateId
        );
        const reloadedReserva = await this.loadReserva(input.idReserva);
        if (!reloadedState || !reloadedReserva) {
            await hospedinOutboundStateService.markFailed(input.stateId, {
                errorCode: 'RECONCILE_REQUIRED',
                errorMessage:
                    'PATCH/SALE Hospedin ok mas falha ao recarregar estado local.',
                hospedinReservationId: input.hospedinReservationId,
            });
            return {
                outcome: 'failed',
                idReservaHospedagem: input.idReserva,
                hospedinReservationId: input.hospedinReservationId,
                errorCode: 'RECONCILE_REQUIRED',
                message: 'PATCH ok — reconciliação manual necessária.',
            };
        }

        const latestInput = buildSyncBaselineFromReserva(reloadedReserva);
        const latestHash = hashOutboundPayload(latestInput);
        const latestPending = String(
            reloadedState.pending_payload_hash || ''
        ).trim();
        const sentHash = hashOutboundPayload(input.sentHashInput);

        if (latestHash !== latestPending || latestHash !== sentHash) {
            await hospedinOutboundStateService.releaseToPending(input.stateId, {
                desiredAction: HospedinOutboundDesiredAction.UPDATE,
            });
            log.info('outbound:update:stale-after-patch', {
                correlationId: input.options?.correlationId,
                idReservaHospedagem: input.idReserva,
                sentHash,
                latestHash,
                latestPending,
            });
            return {
                outcome: 'stale',
                idReservaHospedagem: input.idReserva,
                hospedinReservationId: input.hospedinReservationId,
                message:
                    'Estado Jango mudou durante UPDATE — permanece PENDING_UPDATE.',
            };
        }

        return null;
    }

    private async markIdempotent(
        stateId: number,
        idReserva: number,
        hospedinReservationId: string | null,
        afterInput: OutboundPayloadHashInput,
        state: HospedinOutboundSyncState
    ): Promise<OutboundUpdateResult> {
        await hospedinOutboundStateService.markSynced(stateId, {
            hospedinReservationId,
            syncedHashInputJson:
                state.synced_hash_input_json ??
                serializeHashInput(afterInput),
            appliedPayloadHash: hashOutboundPayload(afterInput),
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
