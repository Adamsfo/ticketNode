import {
    IntegrationEntityType,
    IntegrationProvider,
} from '../../../models/IntegrationSyncState';
import { HospedinLogger } from '../logger/HospedinLogger';
import { integrationSyncStateService } from '../services/IntegrationSyncStateService';
import {
    reservationSyncOrchestrator,
} from './ReservationSyncOrchestrator';
import {
    reservationSyncExecutor,
} from './ReservationSyncExecutor';
import type { ReservationSyncExecutionResult } from './types';

/**
 * Runner: IntegrationSyncState READY → Orchestrator → Executor.
 * Não decide ações; não valida; só dispara CREATE quando o Orchestrator indicar.
 */
export class ReservationSyncRunner {
    async processReady(options?: {
        limit?: number;
    }): Promise<{
        total: number;
        results: ReservationSyncExecutionResult[];
    }> {
        const states = await integrationSyncStateService.findReady({
            provider: IntegrationProvider.HOSPEDIN,
            entityType: IntegrationEntityType.RESERVATION,
            limit: options?.limit ?? 50,
        });

        const results: ReservationSyncExecutionResult[] = [];

        for (const state of states) {
            const decision = reservationSyncOrchestrator.decideFromState(state);
            HospedinLogger.info('sync_runner:decision', {
                external_id: state.external_id,
                correlation_id: state.correlation_id,
                action: decision.action,
                reason: decision.reason,
            });

            if (decision.action !== 'CREATE') {
                results.push({
                    ok: false,
                    action: decision.action,
                    reservationId: decision.reservationId,
                    correlationId: String(state.correlation_id),
                    status: 'SKIPPED',
                    message: `Ação ${decision.action} não executada neste runner (somente CREATE).`,
                    code: 'SKIPPED_NON_CREATE',
                });
                continue;
            }

            results.push(await reservationSyncExecutor.execute(decision));
        }

        return { total: results.length, results };
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

        const decision = reservationSyncOrchestrator.decideFromState(state);
        return reservationSyncExecutor.execute(decision);
    }
}

export const reservationSyncRunner = new ReservationSyncRunner();
