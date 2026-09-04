import { HospedinReservation } from '../../../models/HospedinReservation';
import {
    IntegrationEntityType,
    IntegrationProvider,
    IntegrationSyncStatus,
} from '../../../models/IntegrationSyncState';
import { NOT_IMPLEMENTED } from '../validation/types';
import { HospedinLogger } from '../logger/HospedinLogger';
import {
    HospedinDomainMappingError,
    HospedinReservationDomainMapper,
    PAYLOAD_INCOMPLETE,
} from '../mapper/HospedinReservationDomainMapper';
import { integrationSyncStateService } from '../services/IntegrationSyncStateService';
import { placeSuiteResolver } from '../services/PlaceSuiteResolver';
import { reservationCreationService } from '../services/ReservationCreationService';
import { reservationUpdateService } from '../services/ReservationUpdateService';
import { reservationCancellationService } from '../services/ReservationCancellationService';
import { resolveExistingReservationLink } from '../services/HospedinReservationLinkService';
import { hospedinSyncLogService } from '../services/HospedinSyncLogService';
import {
    applyFailureClassification,
} from '../../core/EntityRunService';
import { recordEntitySyncEvent } from '../../core/EntitySyncEventService';
import {
    normalizeSyncErrorCode,
    severityForErrorCode,
} from '../../core/syncErrorClassification';
import type {
    ReservationExecutionContext,
    ReservationSyncExecutionResult,
    SyncDecision,
} from './types';

/**
 * Executa SyncDecision no domínio Jango.
 * CREATE / UPDATE / CANCEL. Nunca decide a ação.
 */
export class ReservationSyncExecutor {
    async execute(
        decision: SyncDecision
    ): Promise<ReservationSyncExecutionResult> {
        const started = Date.now();

        if (
            decision.action !== 'CREATE' &&
            decision.action !== 'UPDATE' &&
            decision.action !== 'CANCEL'
        ) {
            return {
                ok: false,
                action: decision.action,
                reservationId: decision.reservationId,
                correlationId: '',
                status: NOT_IMPLEMENTED,
                message: `Ação ${decision.action} não executável pelo Executor.`,
                code: NOT_IMPLEMENTED,
            };
        }

        const identity = {
            provider: IntegrationProvider.HOSPEDIN,
            entityType: IntegrationEntityType.RESERVATION,
            externalId: decision.reservationId,
        };

        let syncState = await integrationSyncStateService.findByIdentity(
            identity
        );
        if (!syncState) {
            syncState = await integrationSyncStateService.findOrCreate(identity);
        }

        const correlationId = String(syncState.correlation_id);

        if (decision.action === 'CREATE') {
            if (
                syncState.sync_status === IntegrationSyncStatus.SYNCED ||
                syncState.internal_entity_id
            ) {
                HospedinLogger.info('executor:idempotent_skip', {
                    reservation_id: decision.reservationId,
                    correlation_id: correlationId,
                    internal_entity_id: syncState.internal_entity_id,
                });
                return {
                    ok: true,
                    action: decision.action,
                    reservationId: decision.reservationId,
                    correlationId,
                    internalEntityId: syncState.internal_entity_id,
                    syncVersion: Number(syncState.sync_version || 0),
                    status: IntegrationSyncStatus.SYNCED,
                    message: 'Já sincronizada — create ignorado (idempotência).',
                    code: 'ALREADY_SYNCED',
                };
            }
        }

        try {
            let action = decision.action;

            await integrationSyncStateService.updateState({
                ...identity,
                syncStatus: IntegrationSyncStatus.SYNCING,
                syncAction: action,
                lastError: null,
                reason: `Início ${action}`,
                operacao: 'sync_state_syncing',
            });

            if (action === 'CREATE') {
                const stagingRow = await HospedinReservation.findOne({
                    where: { reservation_id: decision.reservationId },
                });
                const existingLink = await resolveExistingReservationLink({
                    reservationId: decision.reservationId,
                    staging: stagingRow,
                    internalEntityId: syncState.internal_entity_id,
                });

                if (existingLink?.linkOnly) {
                    const synced =
                        await integrationSyncStateService.markSynced({
                            ...identity,
                            internalEntityId: String(
                                existingLink.idReservaHospedagem
                            ),
                            incrementSyncVersion: false,
                            reason: `Vinculada a ReservaHospedagem id=${existingLink.idReservaHospedagem} (${existingLink.matchedBy}, origem=${existingLink.origemReserva}) — sem CREATE.`,
                        });
                    const syncVersion = Number(synced.sync_version || 0);

                    await this.logExecutor({
                        operacao: 'sync_executor_link_existing',
                        started,
                        decision,
                        correlationId,
                        sucesso: true,
                        internalEntityId: existingLink.idReservaHospedagem,
                        syncVersion,
                        response: {
                            idReservaHospedagem:
                                existingLink.idReservaHospedagem,
                            sync_version: syncVersion,
                            matchedBy: existingLink.matchedBy,
                            changes: [
                                {
                                    field: 'link_existing',
                                    before: null,
                                    after: existingLink.idReservaHospedagem,
                                },
                            ],
                            message: `Reserva existente vinculada id=${existingLink.idReservaHospedagem}`,
                        },
                    });

                    await recordEntitySyncEvent({
                        provider: IntegrationProvider.HOSPEDIN,
                        externalId: decision.reservationId,
                        internalEntityId: String(
                            existingLink.idReservaHospedagem
                        ),
                        operation: 'LINK_EXISTING',
                        result: 'SUCCESS',
                        message: `Vinculada a ReservaHospedagem id=${existingLink.idReservaHospedagem} (${existingLink.matchedBy})`,
                        durationMs: Date.now() - started,
                        correlationId,
                    });

                    return {
                        ok: true,
                        action: 'CREATE',
                        reservationId: decision.reservationId,
                        correlationId,
                        internalEntityId: String(
                            existingLink.idReservaHospedagem
                        ),
                        syncVersion,
                        status: IntegrationSyncStatus.SYNCED,
                        message: `Reserva existente vinculada id=${existingLink.idReservaHospedagem} — CREATE não executado.`,
                        code: 'LINKED_EXISTING',
                    };
                }

                if (existingLink && !existingLink.linkOnly) {
                    syncState = await integrationSyncStateService.updateState({
                        ...identity,
                        internalEntityId: String(
                            existingLink.idReservaHospedagem
                        ),
                        reason: `Reserva HOSPEDIN existente id=${existingLink.idReservaHospedagem} — redirecionando para UPDATE.`,
                        operacao: 'sync_state_link_before_update',
                    });
                    action = 'UPDATE';
                } else if (!existingLink) {
                const ctx = await this.buildContext(decision, syncState, {
                    requireSuite: true,
                });
                const created =
                    await reservationCreationService.createFromHospedin(ctx);

                const synced = await integrationSyncStateService.markSynced({
                    ...identity,
                    internalEntityId: String(created.idReservaHospedagem),
                    incrementSyncVersion: true,
                    reason: `CREATE → ReservaHospedagem.id=${created.idReservaHospedagem}`,
                });
                const syncVersion = Number(synced.sync_version || 0);

                await this.logExecutor({
                    operacao: 'sync_executor_create',
                    started,
                    decision,
                    correlationId,
                    sucesso: true,
                    internalEntityId: created.idReservaHospedagem,
                    syncVersion,
                    response: {
                        idReservaHospedagem: created.idReservaHospedagem,
                        sync_version: syncVersion,
                        changes: [
                            {
                                field: 'create',
                                before: null,
                                after: created.idReservaHospedagem,
                            },
                        ],
                        message: `Reserva criada id=${created.idReservaHospedagem} (versão ${syncVersion})`,
                    },
                });

                await recordEntitySyncEvent({
                    provider: IntegrationProvider.HOSPEDIN,
                    externalId: decision.reservationId,
                    internalEntityId: String(created.idReservaHospedagem),
                    operation: 'CREATE',
                    result: 'SUCCESS',
                    message: `Reserva criada id=${created.idReservaHospedagem}`,
                    durationMs: Date.now() - started,
                    correlationId,
                });

                return {
                    ok: true,
                    action: decision.action,
                    reservationId: decision.reservationId,
                    correlationId,
                    internalEntityId: String(created.idReservaHospedagem),
                    syncVersion,
                    status: IntegrationSyncStatus.SYNCED,
                    message: `Reserva criada id=${created.idReservaHospedagem} (versão ${syncVersion})`,
                };
                }
            }

            if (action === 'UPDATE') {
                const ctx = await this.buildContext(decision, syncState, {
                    requireSuite: true,
                });
                const desired =
                    HospedinReservationDomainMapper.toUpdateSnapshot({
                        staging: ctx.stagingReservation,
                        resolvedSuite: ctx.resolvedSuite,
                    });
                const updated = await reservationUpdateService.updateFromHospedin(
                    ctx,
                    desired
                );

                const synced = await integrationSyncStateService.markSynced({
                    ...identity,
                    internalEntityId: String(updated.idReservaHospedagem),
                    incrementSyncVersion: updated.applied === true,
                    reason: updated.applied
                        ? `UPDATE aplicado (${updated.changes.length} alterações)`
                        : 'UPDATE sem alterações operacionais — Already synchronized',
                });
                const syncVersion = Number(synced.sync_version || 0);

                await this.logExecutor({
                    operacao: 'sync_executor_update',
                    started,
                    decision,
                    correlationId,
                    sucesso: true,
                    internalEntityId: updated.idReservaHospedagem,
                    syncVersion,
                    response: {
                        idReservaHospedagem: updated.idReservaHospedagem,
                        applied: updated.applied,
                        sync_version: syncVersion,
                        changes: updated.changes,
                        message: updated.applied
                            ? `Reserva atualizada id=${updated.idReservaHospedagem} (versão ${syncVersion})`
                            : 'Already synchronized',
                    },
                });

                return {
                    ok: true,
                    action: decision.action,
                    reservationId: decision.reservationId,
                    correlationId,
                    internalEntityId: String(updated.idReservaHospedagem),
                    syncVersion,
                    status: IntegrationSyncStatus.SYNCED,
                    message: updated.applied
                        ? `Reserva atualizada id=${updated.idReservaHospedagem} (versão ${syncVersion})`
                        : 'Already synchronized',
                    code: updated.applied ? undefined : 'ALREADY_SYNCED',
                };
            }

            // CANCEL — não exige mapa de suíte
            const ctx = await this.buildContext(decision, syncState, {
                requireSuite: false,
            });
            const cancelled =
                await reservationCancellationService.cancelFromHospedin(ctx);

            const synced = await integrationSyncStateService.markSynced({
                ...identity,
                internalEntityId: String(cancelled.idReservaHospedagem),
                incrementSyncVersion: cancelled.alreadyCancelled !== true,
                reason: cancelled.alreadyCancelled
                    ? 'CANCEL idempotente — já Cancelada'
                    : `CANCEL → ReservaHospedagem.id=${cancelled.idReservaHospedagem}`,
            });
            const syncVersion = Number(synced.sync_version || 0);

            await this.logExecutor({
                operacao: 'sync_executor_cancel',
                started,
                decision,
                correlationId,
                sucesso: true,
                internalEntityId: cancelled.idReservaHospedagem,
                syncVersion,
                response: {
                    idReservaHospedagem: cancelled.idReservaHospedagem,
                    alreadyCancelled: cancelled.alreadyCancelled,
                    sync_version: syncVersion,
                    changes: [
                        {
                            field: 'status',
                            before: cancelled.alreadyCancelled
                                ? 'Cancelada'
                                : 'Confirmada|Hospedada|…',
                            after: 'Cancelada',
                        },
                    ],
                    message: cancelled.alreadyCancelled
                        ? 'Cancelamento já aplicado'
                        : `Reserva cancelada id=${cancelled.idReservaHospedagem} (versão ${syncVersion})`,
                },
            });

            return {
                ok: true,
                action: decision.action,
                reservationId: decision.reservationId,
                correlationId,
                internalEntityId: String(cancelled.idReservaHospedagem),
                syncVersion,
                status: IntegrationSyncStatus.SYNCED,
                message: cancelled.alreadyCancelled
                    ? 'Cancelamento já aplicado'
                    : `Reserva cancelada id=${cancelled.idReservaHospedagem} (versão ${syncVersion})`,
            };
        } catch (error: any) {
            const code =
                error instanceof HospedinDomainMappingError
                    ? error.code
                    : error?.code || 'EXECUTOR_ERROR';
            const message =
                error?.message || `Falha ao executar ${decision.action}.`;

            if (code === 'WAIT_MAPPING') {
                await applyFailureClassification({
                    provider: IntegrationProvider.HOSPEDIN,
                    externalId: decision.reservationId,
                    rawCode: code,
                    message,
                    syncStatus: IntegrationSyncStatus.WAIT_MAPPING,
                    validationStatus: 'WAITING_SUITE_MAPPING',
                });
            } else if (code === 'SUITE_IGNORED') {
                await applyFailureClassification({
                    provider: IntegrationProvider.HOSPEDIN,
                    externalId: decision.reservationId,
                    rawCode: code,
                    message,
                    validationStatus: 'IGNORED',
                });
            } else if (code === 'ORIGIN_CONFLICT') {
                await applyFailureClassification({
                    provider: IntegrationProvider.HOSPEDIN,
                    externalId: decision.reservationId,
                    rawCode: code,
                    message,
                    validationStatus: 'ORIGIN_CONFLICT',
                });
            } else {
                await applyFailureClassification({
                    provider: IntegrationProvider.HOSPEDIN,
                    externalId: decision.reservationId,
                    rawCode: code,
                    message,
                    validationStatus:
                        code === PAYLOAD_INCOMPLETE
                            ? PAYLOAD_INCOMPLETE
                            : undefined,
                });
            }

            await recordEntitySyncEvent({
                provider: IntegrationProvider.HOSPEDIN,
                externalId: decision.reservationId,
                operation: decision.action,
                result: code === 'SUITE_IGNORED' ? 'IGNORED' : 'ERROR',
                errorCode: normalizeSyncErrorCode(code, message),
                errorSeverity:
                    code === 'SUITE_IGNORED'
                        ? 'INFO'
                        : severityForErrorCode(
                              normalizeSyncErrorCode(code, message)
                          ),
                message,
                durationMs: Date.now() - started,
                correlationId,
            });

            HospedinLogger.error('executor:failed', {
                reservation_id: decision.reservationId,
                correlation_id: correlationId,
                action: decision.action,
                code,
                message,
            });

            await this.logExecutor({
                operacao: `sync_executor_${String(decision.action).toLowerCase()}`,
                started,
                decision,
                correlationId,
                sucesso: false,
                syncVersion: Number(syncState.sync_version || 0),
                response: {
                    code,
                    message,
                    sync_version: Number(syncState.sync_version || 0),
                    changes: [],
                },
                status: 500,
            });

            return {
                ok: false,
                action: decision.action,
                reservationId: decision.reservationId,
                correlationId,
                syncVersion: Number(syncState.sync_version || 0),
                status:
                    code === 'WAIT_MAPPING'
                        ? IntegrationSyncStatus.WAIT_MAPPING
                        : IntegrationSyncStatus.FAILED,
                message,
                code: String(code),
            };
        }
    }

    async executeMany(
        decisions: SyncDecision[]
    ): Promise<ReservationSyncExecutionResult[]> {
        const results: ReservationSyncExecutionResult[] = [];
        for (const decision of decisions) {
            results.push(await this.execute(decision));
        }
        return results;
    }

    private async logExecutor(input: {
        operacao: string;
        started: number;
        decision: SyncDecision;
        correlationId: string;
        sucesso: boolean;
        response: {
            changes?: unknown[];
            message?: string;
            idReservaHospedagem?: number | string;
            sync_version?: number;
            [key: string]: unknown;
        };
        status?: number;
        internalEntityId?: string | number | null;
        syncVersion?: number | null;
    }) {
        const type = input.decision.action;
        const timestamp = new Date().toISOString();
        const internal =
            input.internalEntityId ??
            input.response.idReservaHospedagem ??
            null;
        const syncVersion =
            input.syncVersion ?? input.response.sync_version ?? null;
        const changes = Array.isArray(input.response.changes)
            ? input.response.changes
            : [];
        const message =
            input.response.message ||
            (input.sucesso
                ? `${type} ok`
                : String(input.response.message || input.response.code || 'erro'));

        await hospedinSyncLogService.write({
            operacao: input.operacao,
            endpoint: null,
            metodo: null,
            request: {
                type,
                timestamp,
                external_id: input.decision.reservationId,
                internal_entity_id: internal,
                correlation_id: input.correlationId,
                sync_version: syncVersion,
                action: type,
            },
            response: {
                type,
                timestamp,
                external_id: input.decision.reservationId,
                internal_entity_id: internal,
                sync_version: syncVersion,
                changes,
                message,
                ...input.response,
            },
            status: input.status ?? (input.sucesso ? 200 : 500),
            duracaoMs: Date.now() - input.started,
            sucesso: input.sucesso,
            erro: input.sucesso ? null : message,
        });
    }

    private async buildContext(
        decision: SyncDecision,
        syncState: Awaited<
            ReturnType<typeof integrationSyncStateService.findByIdentity>
        >,
        options: { requireSuite: boolean }
    ): Promise<ReservationExecutionContext> {
        if (!syncState) {
            throw new HospedinDomainMappingError(
                'IntegrationSyncState ausente.',
                'SYNC_STATE_MISSING'
            );
        }

        const staging = await HospedinReservation.findOne({
            where: { reservation_id: decision.reservationId },
        });
        if (!staging) {
            throw new HospedinDomainMappingError(
                `Reserva ${decision.reservationId} não encontrada no staging.`,
                PAYLOAD_INCOMPLETE
            );
        }

        if (!options.requireSuite) {
            // CANCEL: resolvedSuite placeholder (CancellationService não usa suíte).
            return {
                decision,
                syncState,
                stagingReservation: staging,
                resolvedSuite: {
                    found: true,
                    status: 'LINKED',
                    placeId: 0,
                    idEventoSuite: 0,
                    idEvento: null,
                    mapId: 0,
                    mappedAt: new Date(0),
                    mappedBy: null,
                },
                correlationId: String(syncState.correlation_id),
            };
        }

        const dto = HospedinReservationDomainMapper.toDtoFromStaging(staging);
        const resolved = await placeSuiteResolver.resolveInternalSuite(
            dto.placeId
        );
        if (!resolved.found) {
            if (resolved.status === 'IGNORED') {
                throw new HospedinDomainMappingError(
                    resolved.message,
                    'SUITE_IGNORED'
                );
            }
            throw new HospedinDomainMappingError(
                resolved.message,
                'WAIT_MAPPING'
            );
        }

        return {
            decision,
            syncState,
            stagingReservation: staging,
            resolvedSuite: resolved,
            correlationId: String(syncState.correlation_id),
        };
    }
}

export const reservationSyncExecutor = new ReservationSyncExecutor();
