import {
    IntegrationEntityType,
    IntegrationProvider,
    IntegrationSyncStatus,
} from '../../../models/IntegrationSyncState';
import { HospedinLogger } from '../logger/HospedinLogger';
import { HospedinReservation } from '../../../models/HospedinReservation';
import { integrationSyncStateService } from '../services/IntegrationSyncStateService';
import { hospedinSyncLogService } from '../services/HospedinSyncLogService';
import {
    getOperationalSyncWindow,
    isWithinOperationalSyncWindow,
    parseHospedinSyncMode,
    type HospedinSyncMode,
} from '../utils/operationalSyncWindow';
import { reservationSyncOrchestrator } from './ReservationSyncOrchestrator';
import { reservationSyncExecutor } from './ReservationSyncExecutor';
import { linkedExistingSuiteSyncService } from '../services/LinkedExistingSuiteSyncService';
import type { ReservationSyncExecutionResult } from './types';

/**
 * Runner: IntegrationSyncState READY → Orchestrator → Executor.
 * CREATE / UPDATE / CANCEL. IGNORE(SYNCED) e CONFLICT não quebram o lote.
 *
 * Incremental (padrão): só executa READY dentro da janela operacional.
 * Full: processa qualquer READY.
 */
export class ReservationSyncRunner {
    async processReady(options?: {
        limit?: number;
        mode?: HospedinSyncMode | string;
    }): Promise<{
        total: number;
        discarded: number;
        mode: HospedinSyncMode;
        results: ReservationSyncExecutionResult[];
    }> {
        const limit = options?.limit ?? 50;
        const mode = parseHospedinSyncMode(options?.mode, 'incremental');
        const window = getOperationalSyncWindow();

        // Busca um lote amplo: no incremental, READY antigos fora da janela
        // permanecem READY e seriam "reencontrados" com offset — filtramos em memória.
        const scanLimit =
            mode === 'full' ? limit : Math.max(limit * 20, 500);
        const states = await integrationSyncStateService.list({
            provider: IntegrationProvider.HOSPEDIN,
            entityType: IntegrationEntityType.RESERVATION,
            syncStatus: IntegrationSyncStatus.READY,
            limit: scanLimit,
            offset: 0,
        });

        const results: ReservationSyncExecutionResult[] = [];
        let discarded = 0;

        for (const state of states) {
            if (results.length >= limit) break;

            if (mode === 'incremental') {
                const inWindow = await this.isReservationInWindow(
                    state.external_id,
                    window
                );
                if (!inWindow) {
                    discarded += 1;
                    continue;
                }
            }

            try {
                results.push(await this.runDecision(state));
            } catch (error: any) {
                HospedinLogger.error('sync_runner:item_failed', {
                    external_id: state.external_id,
                    message: error?.message,
                });
                results.push({
                    ok: false,
                    action: 'ERROR',
                    reservationId: Number(state.external_id) || 0,
                    correlationId: String(state.correlation_id),
                    status: 'FAILED',
                    message:
                        error?.message || 'Falha inesperada no runner.',
                    code: 'RUNNER_ERROR',
                });
            }
        }

        return {
            total: results.length,
            discarded,
            mode,
            results,
        };
    }

    private async isReservationInWindow(
        externalId: string | number,
        window: ReturnType<typeof getOperationalSyncWindow>
    ): Promise<boolean> {
        const row = await HospedinReservation.findOne({
            where: { reservation_id: Number(externalId) },
            attributes: ['checkin', 'checkout'],
        });
        if (!row) return false;
        return isWithinOperationalSyncWindow(
            row.checkin,
            row.checkout,
            window
        );
    }

    async processOne(
        reservationId: number
    ): Promise<ReservationSyncExecutionResult> {
        const state = await integrationSyncStateService.findByIdentity({
            provider: IntegrationProvider.HOSPEDIN,
            entityType: IntegrationEntityType.RESERVATION,
            externalId: reservationId,
        });
        if (!state) {
            return {
                ok: false,
                action: 'ERROR',
                reservationId,
                correlationId: '',
                status: 'FAILED',
                message: `IntegrationSyncState não encontrado para reservationId=${reservationId}.`,
                code: 'SYNC_STATE_MISSING',
            };
        }

        return this.runDecision(state);
    }

    private async runDecision(state: {
        external_id: string;
        correlation_id: string;
        sync_status: string;
        validation_status: string | null;
        internal_entity_id: string | null;
        last_error: string | null;
        sync_version?: number;
    }): Promise<ReservationSyncExecutionResult> {
        const decision = reservationSyncOrchestrator.decideFromState(
            state as any
        );
        HospedinLogger.info('sync_runner:decision', {
            external_id: state.external_id,
            correlation_id: state.correlation_id,
            action: decision.action,
            reason: decision.reason,
        });

        // UNCHANGED / já SYNCED
        if (
            decision.action === 'IGNORE' &&
            String(state.sync_status) === IntegrationSyncStatus.SYNCED
        ) {
            let linkedExistingSuiteChanges: Array<{
                field: string;
                before: unknown;
                after: unknown;
            }> = [];
            if (String(state.validation_status) === 'LINKED_EXISTING') {
                const suiteSync =
                    await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
                        reservationId: decision.reservationId,
                        internalEntityId: state.internal_entity_id,
                        correlationId: state.correlation_id,
                    });
                linkedExistingSuiteChanges = suiteSync.changes;
            }

            const syncVersion = Number(state.sync_version || 0);
            const result: ReservationSyncExecutionResult = {
                ok: true,
                action: 'IGNORE',
                reservationId: decision.reservationId,
                correlationId: String(state.correlation_id),
                internalEntityId: state.internal_entity_id,
                syncVersion,
                status: IntegrationSyncStatus.SYNCED,
                message:
                    linkedExistingSuiteChanges.length > 0
                        ? `Campos sincronizados (${linkedExistingSuiteChanges.length} alteração)`
                        : 'Already synchronized',
                code: 'ALREADY_SYNCED',
            };
            await hospedinSyncLogService.write({
                operacao: 'sync_unchanged',
                request: {
                    type: 'UNCHANGED',
                    timestamp: new Date().toISOString(),
                    external_id: decision.reservationId,
                    internal_entity_id: state.internal_entity_id,
                    sync_version: syncVersion,
                },
                response: {
                    type: 'UNCHANGED',
                    timestamp: new Date().toISOString(),
                    external_id: decision.reservationId,
                    internal_entity_id: state.internal_entity_id,
                    sync_version: syncVersion,
                    changes: linkedExistingSuiteChanges,
                    message: result.message,
                },
                status: 200,
                sucesso: true,
            });
            return result;
        }

        // ORIGIN_CONFLICT / FAILED de validação
        if (
            decision.action === 'ERROR' &&
            String(state.validation_status) === 'ORIGIN_CONFLICT'
        ) {
            const syncVersion = Number(state.sync_version || 0);
            const result: ReservationSyncExecutionResult = {
                ok: false,
                action: 'ERROR',
                reservationId: decision.reservationId,
                correlationId: String(state.correlation_id),
                internalEntityId: state.internal_entity_id,
                syncVersion,
                status: IntegrationSyncStatus.FAILED,
                message:
                    state.last_error ||
                    'ORIGIN_CONFLICT — Hospedin não sobrescreve.',
                code: 'ORIGIN_CONFLICT',
            };
            await hospedinSyncLogService.write({
                operacao: 'sync_conflict_origin',
                request: {
                    type: 'CONFLICT',
                    timestamp: new Date().toISOString(),
                    external_id: decision.reservationId,
                    internal_entity_id: state.internal_entity_id,
                    sync_version: syncVersion,
                },
                response: {
                    type: 'CONFLICT',
                    timestamp: new Date().toISOString(),
                    external_id: decision.reservationId,
                    internal_entity_id: state.internal_entity_id,
                    sync_version: syncVersion,
                    changes: [],
                    message: result.message,
                },
                status: 409,
                sucesso: false,
                erro: result.message,
            });
            return result;
        }

        if (
            decision.action !== 'CREATE' &&
            decision.action !== 'UPDATE' &&
            decision.action !== 'CANCEL'
        ) {
            return {
                ok: false,
                action: decision.action,
                reservationId: decision.reservationId,
                correlationId: String(state.correlation_id),
                status: 'SKIPPED',
                message: `Ação ${decision.action} não executada neste runner.`,
                code: 'SKIPPED',
            };
        }

        return reservationSyncExecutor.execute(decision);
    }
}

export const reservationSyncRunner = new ReservationSyncRunner();
