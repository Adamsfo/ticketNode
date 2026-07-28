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
 *   · Import enriquece guest principal via GET /guests/{id} se payload sem nomes
 *   · monta ReservationExecutionContext
 *   · CREATE → ReservationCreationService
 *   · UPDATE → Diff → PatchBuilder → ReservationUpdateService
 *   · CANCEL → ReservationCancellationService (encapsula cancelarReservaHospedagem)
 *   · PlaceSuiteResolver (nunca HospedinPlaceSuiteMap direto; cache TTL curto)
 *   ↓
 * Jango
 *
 * Regras:
 * - Executor não decide.
 * - CANCEL classificado na Validation antes do hash.
 * - origemReserva=HOSPEDIN prevalece; senão ORIGIN_CONFLICT.
 * - Hóspedes no UPDATE: replace completo.
 * - Import: se só guest_id, enriquece titular via API Guests (pipeline oficial).
 * - GuestResolverService: CPF → Usuario existente ou novo (sem sobrescrever cadastro).
 * - Sem sync financeiro.
 * - Logs: type, timestamp, external_id, internal_entity_id, sync_version, changes[], message.
 * - sync_version sobe só em aplicação efetiva (CREATE / UPDATE com mudanças / CANCEL).
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
