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
import { hospedinSyncLogService } from '../services/HospedinSyncLogService';
import type {
    ReservationExecutionContext,
    ReservationSyncExecutionResult,
    SyncDecision,
} from './types';

/**
 * Executa SyncDecision no domínio Jango.
 *
 * CREATE: via ReservationCreationService (não chama checkoutHospedagem direto).
 * UPDATE / CANCEL: ainda NOT_IMPLEMENTED.
 *
 * Não decide ações. Não valida regras de negócio do Jango.
 * Não acessa HospedinPlaceSuiteMap (usa PlaceSuiteResolver).
 */
export class ReservationSyncExecutor {
    async execute(
        decision: SyncDecision
    ): Promise<ReservationSyncExecutionResult> {
        const started = Date.now();

        if (decision.action !== 'CREATE') {
            return {
                ok: false,
                action: decision.action,
                reservationId: decision.reservationId,
                correlationId: '',
                status: NOT_IMPLEMENTED,
                message: `Ação ${decision.action} ainda não implementada no Executor.`,
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

        // Idempotência oficial via IntegrationSyncState.
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
                status: IntegrationSyncStatus.SYNCED,
                message: 'Já sincronizada — create ignorado (idempotência).',
                code: 'ALREADY_SYNCED',
            };
        }

        try {
            await integrationSyncStateService.updateState({
                ...identity,
                syncStatus: IntegrationSyncStatus.SYNCING,
                syncAction: decision.action,
                lastError: null,
                reason: 'Início CREATE',
                operacao: 'sync_state_syncing',
            });

            const ctx = await this.buildCreateContext(decision, syncState);
            const created =
                await reservationCreationService.createFromHospedin(ctx);

            await integrationSyncStateService.markSynced({
                ...identity,
                internalEntityId: String(created.idReservaHospedagem),
                reason: `CREATE → ReservaHospedagem.id=${created.idReservaHospedagem}`,
            });

            await hospedinSyncLogService.write({
                operacao: 'sync_executor_create',
                endpoint: null,
                metodo: null,
                request: {
                    reservation_id: decision.reservationId,
                    correlation_id: correlationId,
                },
                response: {
                    idReservaHospedagem: created.idReservaHospedagem,
                    idEvento: created.idEvento,
                    idEventoSuite: created.idEventoSuite,
                },
                status: 200,
                duracaoMs: Date.now() - started,
                sucesso: true,
            });

            return {
                ok: true,
                action: decision.action,
                reservationId: decision.reservationId,
                correlationId,
                internalEntityId: String(created.idReservaHospedagem),
                status: IntegrationSyncStatus.SYNCED,
                message: `Reserva criada id=${created.idReservaHospedagem}`,
            };
        } catch (error: any) {
            const code =
                error instanceof HospedinDomainMappingError
                    ? error.code
                    : error?.code || 'EXECUTOR_ERROR';
            const message =
                error?.message || 'Falha ao executar CREATE da reserva.';

            if (code === 'WAIT_MAPPING') {
                await integrationSyncStateService.updateState({
                    ...identity,
                    syncStatus: IntegrationSyncStatus.WAIT_MAPPING,
                    validationStatus: 'WAITING_SUITE_MAPPING',
                    lastError: message,
                    incrementRetry: true,
                    reason: message,
                    operacao: 'sync_state_wait_mapping',
                });
            } else {
                await integrationSyncStateService.markError({
                    ...identity,
                    error: message,
                    ...(code === PAYLOAD_INCOMPLETE
                        ? { validationStatus: PAYLOAD_INCOMPLETE }
                        : {}),
                    reason: `CREATE failed: ${code}`,
                });
            }

            HospedinLogger.error('executor:create_failed', {
                reservation_id: decision.reservationId,
                correlation_id: correlationId,
                code,
                message,
            });

            await hospedinSyncLogService.write({
                operacao: 'sync_executor_create',
                endpoint: null,
                metodo: null,
                request: {
                    reservation_id: decision.reservationId,
                    correlation_id: correlationId,
                },
                response: { code, message },
                status: 500,
                duracaoMs: Date.now() - started,
                sucesso: false,
            });

            return {
                ok: false,
                action: decision.action,
                reservationId: decision.reservationId,
                correlationId,
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

    private async buildCreateContext(
        decision: SyncDecision,
        syncState: Awaited<
            ReturnType<typeof integrationSyncStateService.findByIdentity>
        >
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

        const dto = HospedinReservationDomainMapper.toDtoFromStaging(staging);
        const resolved = await placeSuiteResolver.resolveInternalSuite(
            dto.placeId
        );
        if (!resolved.found) {
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
