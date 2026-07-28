/**
 * Pipeline Hospedin → Jango
 *
 * Hospedin API
 *   ↓
 * Import Services
 *   ↓
 * Tabelas de Staging
 *   ↓
 * [Admin] hospedin_place_suite_map     (config permanente place ↔ EventoSuite)
 *   ↓
 * HospedinReservationValidationService
 *   · validateSuiteMapping via PlaceSuiteResolver
 *   ↓
 * ValidationResult → IntegrationSyncState
 *   ↓
 * ReservationSyncOrchestrator → SyncDecision
 *   ↓
 * ReservationSyncExecutor
 *   · monta ReservationExecutionContext
 *   · CREATE → ReservationCreationService.createFromHospedin
 *   · DomainMapper: Hospedin → params Jango (sem hóspedes fictícios)
 *   · PlaceSuiteResolver (nunca HospedinPlaceSuiteMap direto)
 *   ↓
 * Jango (checkoutHospedagem origem=integracao / origemReserva=HOSPEDIN)
 *
 * Regras:
 * - Executor não decide; não chama checkoutHospedagem diretamente.
 * - Idempotência via IntegrationSyncState (+ internal_entity_id).
 * - Payload incompleto → FAILED + validation_status PAYLOAD_INCOMPLETE.
 */

export type HospedinSyncPipelineStage =
    | 'import'
    | 'staging'
    | 'suite_mapping'
    | 'validation'
    | 'sync_state'
    | 'orchestration'
    | 'execution'
    | 'jango';

export const HOSPEDIN_SYNC_PIPELINE: HospedinSyncPipelineStage[] = [
    'import',
    'staging',
    'suite_mapping',
    'validation',
    'sync_state',
    'orchestration',
    'execution',
    'jango',
];
