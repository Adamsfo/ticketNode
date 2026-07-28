/**
 * Contrato do pipeline:
 * Staging → Validation → ValidationResult → IntegrationSyncState
 *   → Orchestrator → SyncDecision → Executor → Jango
 */

export type ValidationStatus =
    | 'READY_TO_SYNC'
    | 'WAITING_SUITE_MAPPING'
    | 'ALREADY_IMPORTED'
    | 'PAYLOAD_INVALID'
    | 'INVALID_STATUS'
    | 'INVALID_DATES'
    | 'CANCELLED'
    | 'ERROR';

export type ValidationStep = {
    rule: string;
    success: boolean;
    message: string;
    durationMs: number;
    /** false = regra ainda não implementada (NOT_IMPLEMENTED). */
    implemented: boolean;
    /** Código opcional para classificação do resultado. */
    code?: string;
};

export type ValidationResult = {
    reservationId: number;
    ready: boolean;
    status: ValidationStatus;
    errors: string[];
    warnings: string[];
    validations: ValidationStep[];
};

export const NOT_IMPLEMENTED = 'NOT_IMPLEMENTED';
