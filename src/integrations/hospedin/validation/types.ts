/**
 * Contrato do pipeline:
 * Staging → Validation → ValidationResult → IntegrationSyncState
 *   → Orchestrator → SyncDecision → Executor → Jango
 */

export type ValidationStatus =
    | 'READY_TO_SYNC'
    | 'WAITING_SUITE_MAPPING'
    | 'ALREADY_IMPORTED'
    /** Hash igual — sem UPDATE/CANCEL operacional. */
    | 'UNCHANGED'
    | 'PAYLOAD_INVALID'
    | 'INVALID_STATUS'
    | 'INVALID_DATES'
    | 'CANCELLED'
    /** Reserva Jango existe mas origem ≠ HOSPEDIN. */
    | 'ORIGIN_CONFLICT'
    /** Reserva local encontrada por id_externo/codigo_externo — vincular sem CREATE/UPDATE. */
    | 'LINKED_EXISTING'
    | 'IGNORED'
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
    /** ReservaHospedagem vinculada nesta validação (quando aplicável). */
    internalEntityId?: number;
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
