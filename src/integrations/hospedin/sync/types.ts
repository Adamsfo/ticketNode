/**
 * Decisão de sincronização (sem execução).
 * Produzida pelo ReservationSyncOrchestrator a partir de IntegrationSyncState.
 */

import type { IntegrationSyncState } from '../../../models/IntegrationSyncState';
import type { HospedinReservation } from '../../../models/HospedinReservation';
import type { ResolvedInternalSuite } from '../services/PlaceSuiteResolver';

export type SyncAction =
    | 'CREATE'
    | 'UPDATE'
    | 'CANCEL'
    | 'IGNORE'
    | 'WAIT_MAPPING'
    | 'ERROR';

export type SyncDecision = {
    reservationId: number;
    action: SyncAction;
    reason: string;
};

/**
 * Contexto de execução do ReservationSyncExecutor.
 * Centraliza inputs já resolvidos para CREATE / UPDATE / CANCEL futuros.
 */
export type ReservationExecutionContext = {
    decision: SyncDecision;
    syncState: IntegrationSyncState;
    stagingReservation: HospedinReservation;
    resolvedSuite: ResolvedInternalSuite & { found: true };
    correlationId: string;
};

export type ReservationSyncExecutionResult = {
    ok: boolean;
    action: SyncAction;
    reservationId: number;
    correlationId: string;
    internalEntityId?: string | null;
    /** Versão de sync após a operação (não sobe em UNCHANGED/CONFLICT/falha). */
    syncVersion?: number | null;
    status: string;
    message?: string;
    code?: string;
};
