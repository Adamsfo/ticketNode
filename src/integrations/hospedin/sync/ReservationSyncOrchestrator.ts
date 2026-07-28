import { HospedinLogger } from '../logger/HospedinLogger';
import type { IntegrationSyncState } from '../../../models/IntegrationSyncState';
import { IntegrationSyncStatus } from '../../../models/IntegrationSyncState';
import type { SyncDecision } from './types';

/**
 * Decide a operação futura de sync a partir de IntegrationSyncState.
 *
 * NÃO executa sincronização.
 * NÃO acessa staging.
 * NÃO acessa domínio Jango.
 * NÃO cria/atualiza reservas.
 *
 * Fluxo: ValidationResult → IntegrationSyncState → Orchestrator → SyncDecision
 */
export class ReservationSyncOrchestrator {
    decideFromState(state: IntegrationSyncState): SyncDecision {
        const decision = this.mapStateToDecision(state);

        HospedinLogger.info('orchestrator:decision', {
            reservation_id: decision.reservationId,
            sync_state_id: state.id,
            correlation_id: state.correlation_id,
            action: decision.action,
            reason: decision.reason,
            sync_status: state.sync_status,
            validation_status: state.validation_status,
        });

        return decision;
    }

    decideManyFromState(states: IntegrationSyncState[]): SyncDecision[] {
        return states.map((s) => this.decideFromState(s));
    }

    private mapStateToDecision(state: IntegrationSyncState): SyncDecision {
        const reservationId = Number(state.external_id);
        const syncStatus = String(state.sync_status);
        const validationStatus = String(state.validation_status || '');

        switch (syncStatus) {
            case IntegrationSyncStatus.READY:
                if (validationStatus === 'ALREADY_IMPORTED') {
                    return {
                        reservationId,
                        action: 'UPDATE',
                        reason: 'Estado READY com validation ALREADY_IMPORTED.',
                    };
                }
                if (validationStatus === 'CANCELLED') {
                    return {
                        reservationId,
                        action: 'CANCEL',
                        reason: 'Estado READY com validation CANCELLED.',
                    };
                }
                return {
                    reservationId,
                    action: 'CREATE',
                    reason:
                        'Estado READY — CREATE (até existir distinção ALREADY_IMPORTED).',
                };

            case IntegrationSyncStatus.WAIT_MAPPING:
                return {
                    reservationId,
                    action: 'WAIT_MAPPING',
                    reason: 'Estado WAIT_MAPPING — aguardando mapeamento de suíte.',
                };

            case IntegrationSyncStatus.IGNORED:
                return {
                    reservationId,
                    action: 'IGNORE',
                    reason: state.last_error || 'Estado IGNORED.',
                };

            case IntegrationSyncStatus.FAILED:
                return {
                    reservationId,
                    action: 'ERROR',
                    reason: state.last_error || 'Estado FAILED.',
                };

            case IntegrationSyncStatus.SYNCED:
                return {
                    reservationId,
                    action: 'IGNORE',
                    reason: 'Já sincronizado (SYNCED).',
                };

            case IntegrationSyncStatus.SYNCING:
            case IntegrationSyncStatus.QUEUED:
                return {
                    reservationId,
                    action: 'IGNORE',
                    reason: `Em andamento (${syncStatus}) — sem nova decisão.`,
                };

            case IntegrationSyncStatus.NEW:
            case IntegrationSyncStatus.VALIDATED:
                return {
                    reservationId,
                    action: 'IGNORE',
                    reason: `Estado ${syncStatus} — ainda não pronto para execução.`,
                };

            default:
                return {
                    reservationId,
                    action: 'ERROR',
                    reason: `sync_status desconhecido: ${syncStatus}`,
                };
        }
    }
}

export const reservationSyncOrchestrator = new ReservationSyncOrchestrator();
