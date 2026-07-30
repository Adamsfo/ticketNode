import {
    IntegrationEntityType,
    IntegrationProvider,
    IntegrationSyncStatus,
    type IntegrationSyncStatusValue,
} from '../../../models/IntegrationSyncState';
import { HospedinReservation } from '../../../models/HospedinReservation';
import type { HospedinReservationDto } from '../dto';
import { HospedinLogger } from '../logger/HospedinLogger';
import { HospedinReservationMapper } from '../mapper/HospedinReservationMapper';
import { asRecord } from '../mapper/mapperHelpers';
import { reservationSyncOrchestrator } from '../sync/ReservationSyncOrchestrator';
import {
    getOperationalSyncWindow,
    isWithinOperationalSyncWindow,
    parseHospedinSyncMode,
} from '../utils/operationalSyncWindow';
import {
    NOT_IMPLEMENTED,
    type ValidationResult,
    type ValidationStatus,
    type ValidationStep,
} from '../validation/types';
import { integrationSyncStateService } from './IntegrationSyncStateService';
import { hospedinSyncLogService } from './HospedinSyncLogService';
import { placeSuiteResolver } from './PlaceSuiteResolver';
import {
    isHospedinCancelledStatus,
    isHospedinSyncableActiveStatus,
} from '../sync/hospedinReservationStatus';
import {
    isPermanentNonActionableError,
    normalizeSyncErrorCode,
    severityForErrorCode,
    SyncErrorCode,
    SyncResolutionStatus,
} from '../../core/syncErrorClassification';
import { recordEntitySyncEvent } from '../../core/EntitySyncEventService';

type ValidationContext = {
    reservationId: number;
    row: HospedinReservation;
    payload: Record<string, unknown> | null;
    dto: HospedinReservationDto | null;
};

/**
 * Analisa reservas do staging e decide se estão aptas à sincronização.
 *
 * Pipeline:
 * Validation → ValidationResult → IntegrationSyncState → Orchestrator → SyncDecision
 *
 * NÃO cria/altera reservas do Jango.
 * NÃO chama Executor.
 * NÃO acessa HospedinPlaceSuiteMap / EventoSuite diretamente.
 * Mapeamento de suíte: apenas via PlaceSuiteResolver.resolveInternalSuite.
 * A sincronização futura consome IntegrationSyncState (não staging direto).
 */
export class HospedinReservationValidationService {
    async validateReservation(
        reservationId: number
    ): Promise<ValidationResult> {
        const started = Date.now();
        const id = Number(reservationId);

        if (!Number.isFinite(id) || id <= 0) {
            return this.buildResult({
                reservationId: id || 0,
                steps: [
                    {
                        rule: 'validateReservationId',
                        success: false,
                        message: 'reservationId inválido.',
                        durationMs: 0,
                        implemented: true,
                    },
                ],
            });
        }

        const row = await HospedinReservation.findOne({
            where: { reservation_id: id },
        });

        if (!row) {
            const step: ValidationStep = {
                rule: 'loadStaging',
                success: false,
                message: `Reserva ${id} não encontrada em hospedin_reservations.`,
                durationMs: Date.now() - started,
                implemented: true,
            };
            this.logRule(id, step);
            const result = this.buildResult({ reservationId: id, steps: [step] });
            const { state: syncState, validationStatus } =
                await this.persistSyncStateFromValidation(result, null);
            result.status = validationStatus;
            return result;
        }

        const payload = this.readPayload(row);
        let dto: HospedinReservationDto | null = null;
        try {
            if (payload) {
                dto = HospedinReservationMapper.toDto({
                    ...payload,
                    id: payload.id ?? row.reservation_id,
                    status: payload.status ?? row.status,
                    check_in: payload.check_in ?? row.checkin,
                    check_out: payload.check_out ?? row.checkout,
                    place_id: payload.place_id,
                    place_type_id: payload.place_type_id,
                    searchable_code: payload.searchable_code,
                });
            }
        } catch {
            dto = null;
        }

        const ctx: ValidationContext = {
            reservationId: id,
            row,
            payload,
            dto,
        };

        const steps: ValidationStep[] = [
            this.runRule(ctx, 'validatePayload', () =>
                this.validatePayload(ctx)
            ),
            this.runRule(ctx, 'validateRequiredFields', () =>
                this.validateRequiredFields(ctx)
            ),
            this.runRule(ctx, 'validateReservationStatus', () =>
                this.validateReservationStatus(ctx)
            ),
            this.runRule(ctx, 'validateDates', () => this.validateDates(ctx)),
            this.runRule(ctx, 'validateGuests', () => this.validateGuests(ctx)),
            await this.runRuleAsync(ctx, () => this.validateSuiteMapping(ctx)),
            await this.runRuleAsync(ctx, () =>
                this.validateExistingReservation(ctx)
            ),
            this.runRule(ctx, 'validateDuplicates', () =>
                this.validateDuplicates(ctx)
            ),
            this.runRule(ctx, 'validateIntegrity', () =>
                this.validateIntegrity(ctx)
            ),
        ];

        const result = this.buildResult({ reservationId: id, steps });

        const { state: syncState, validationStatus } =
            await this.persistSyncStateFromValidation(result, ctx.payload);
        result.status = validationStatus;
        if (validationStatus === 'UNCHANGED') {
            result.ready = false;
        }

        await hospedinSyncLogService.write({
            operacao: this.operacaoFromValidation(validationStatus),
            endpoint: '/api/integrations/hospedin/validate/reservations',
            metodo: 'POST',
            request: {
                reservationId: id,
                type: validationStatus,
                timestamp: new Date().toISOString(),
                external_id: id,
                internal_entity_id: syncState.internal_entity_id,
            },
            response: {
                type: validationStatus,
                timestamp: new Date().toISOString(),
                external_id: id,
                internal_entity_id: syncState.internal_entity_id,
                ready: result.ready,
                status: validationStatus,
                errors: result.errors,
                warnings: result.warnings,
                sync_state_id: syncState.id,
                correlation_id: syncState.correlation_id,
                sync_status: syncState.sync_status,
                sync_action: syncState.sync_action,
                payload_hash: syncState.payload_hash,
                changes: [],
                message: this.messageFromValidation(validationStatus),
            },
            status: 200,
            duracaoMs: Date.now() - started,
            sucesso: validationStatus !== 'ORIGIN_CONFLICT' && validationStatus !== 'ERROR',
        });

        return result;
    }

    /**
     * Valida staging. No modo incremental (padrão), aplica a mesma janela
     * operacional do Import (somente check_in >= hoje).
     * mode=full valida absolutamente todas as linhas do staging.
     */
    async validateAll(options?: {
        mode?: string;
    }): Promise<{
        total: number;
        ready: number;
        discarded: number;
        mode: 'incremental' | 'full';
        results: ValidationResult[];
    }> {
        const mode = parseHospedinSyncMode(options?.mode, 'incremental');
        const window = getOperationalSyncWindow();

        const rows = await HospedinReservation.findAll({
            attributes: ['reservation_id', 'checkin', 'checkout'],
            order: [['reservation_id', 'ASC']],
        });

        const selected =
            mode === 'full'
                ? rows
                : rows.filter((row) =>
                      isWithinOperationalSyncWindow(
                          row.checkin,
                          row.checkout,
                          window
                      )
                  );
        const discarded = rows.length - selected.length;

        const results: ValidationResult[] = [];
        for (const row of selected) {
            results.push(
                await this.validateReservation(Number(row.reservation_id))
            );
        }

        return {
            total: results.length,
            ready: results.filter((r) => r.ready).length,
            discarded,
            mode,
            results,
        };
    }

    // ─── Regras implementadas (payload) ─────────────────────────

    validatePayload(ctx: ValidationContext): ValidationStep {
        const started = Date.now();
        if (!ctx.payload || typeof ctx.payload !== 'object') {
            return {
                rule: 'validatePayload',
                success: false,
                message: 'payload_json ausente ou inválido no staging.',
                durationMs: Date.now() - started,
                implemented: true,
            };
        }

        return {
            rule: 'validatePayload',
            success: true,
            message: 'Payload válido.',
            durationMs: Date.now() - started,
            implemented: true,
        };
    }

    validateRequiredFields(ctx: ValidationContext): ValidationStep {
        const started = Date.now();
        const missing: string[] = [];

        if (!ctx.payload) {
            return {
                rule: 'validateRequiredFields',
                success: false,
                message: 'Sem payload para validar campos obrigatórios.',
                durationMs: Date.now() - started,
                implemented: true,
            };
        }

        const id =
            ctx.payload.id ??
            ctx.row.reservation_id ??
            ctx.dto?.reservationId;
        if (id == null || id === '') missing.push('id');

        const checkIn = ctx.payload.check_in ?? ctx.row.checkin;
        if (checkIn == null || checkIn === '') missing.push('check_in');

        const checkOut = ctx.payload.check_out ?? ctx.row.checkout;
        if (checkOut == null || checkOut === '') missing.push('check_out');

        const status = ctx.payload.status ?? ctx.row.status;
        if (status == null || status === '') missing.push('status');

        if (missing.length) {
            return {
                rule: 'validateRequiredFields',
                success: false,
                message: `Campos obrigatórios ausentes: ${missing.join(', ')}.`,
                durationMs: Date.now() - started,
                implemented: true,
            };
        }

        return {
            rule: 'validateRequiredFields',
            success: true,
            message: 'Campos obrigatórios do payload presentes.',
            durationMs: Date.now() - started,
            implemented: true,
        };
    }

    validateReservationStatus(ctx: ValidationContext): ValidationStep {
        const started = Date.now();
        const status = ctx.dto?.status ?? ctx.payload?.status ?? ctx.row.status;

        if (isHospedinCancelledStatus(status)) {
            return {
                rule: 'validateReservationStatus',
                success: true,
                message: `Status Hospedin cancelado (${status}).`,
                durationMs: Date.now() - started,
                implemented: true,
                code: 'CANCELLED',
            };
        }

        if (isHospedinSyncableActiveStatus(status)) {
            return {
                rule: 'validateReservationStatus',
                success: true,
                message: `Status Hospedin operacional (${status}).`,
                durationMs: Date.now() - started,
                implemented: true,
                code: 'ACTIVE',
            };
        }

        return {
            rule: 'validateReservationStatus',
            success: true,
            message: `Status Hospedin ignorado para sync de domínio (${status}).`,
            durationMs: Date.now() - started,
            implemented: true,
            code: 'IGNORED_STATUS',
        };
    }

    validateDates(ctx: ValidationContext): ValidationStep {
        const started = Date.now();
        const checkin = ctx.dto?.checkin ?? null;
        const checkout = ctx.dto?.checkout ?? null;
        if (!checkin || !checkout) {
            return {
                rule: 'validateDates',
                success: false,
                message: 'check_in/check_out inválidos.',
                durationMs: Date.now() - started,
                implemented: true,
                code: 'INVALID_DATES',
            };
        }
        if (checkout.getTime() <= checkin.getTime()) {
            return {
                rule: 'validateDates',
                success: false,
                message: 'check_out deve ser posterior a check_in.',
                durationMs: Date.now() - started,
                implemented: true,
                code: 'INVALID_DATES',
            };
        }
        return {
            rule: 'validateDates',
            success: true,
            message: 'Datas válidas.',
            durationMs: Date.now() - started,
            implemented: true,
        };
    }

    validateGuests(_ctx: ValidationContext): ValidationStep {
        // Contagens adults/children bastam para UPDATE; CREATE continua
        // exigindo nomes no DomainMapper.
        return {
            rule: 'validateGuests',
            success: true,
            message: 'Validação de hóspedes adiada ao mapper de execução.',
            durationMs: 0,
            implemented: true,
        };
    }

    /**
     * Consulta apenas PlaceSuiteResolver (sem model/DB de mapeamento direto).
     */
    async validateSuiteMapping(ctx: ValidationContext): Promise<ValidationStep> {
        const started = Date.now();
        const placeId =
            ctx.dto?.placeId ??
            (ctx.payload?.place_id != null
                ? Number(ctx.payload.place_id)
                : null);

        const resolved = await placeSuiteResolver.resolveInternalSuite(placeId);

        if (!resolved.found) {
            if (resolved.status === 'IGNORED') {
                return {
                    rule: 'validateSuiteMapping',
                    success: true,
                    message: resolved.message,
                    durationMs: Date.now() - started,
                    implemented: true,
                    code: 'SUITE_IGNORED',
                };
            }
            return {
                rule: 'validateSuiteMapping',
                success: false,
                message: resolved.message,
                durationMs: Date.now() - started,
                implemented: true,
                code:
                    resolved.reason === 'INVALID_PLACE_ID'
                        ? 'INVALID_PLACE_ID'
                        : 'WAITING_SUITE_MAPPING',
            };
        }

        return {
            rule: 'validateSuiteMapping',
            success: true,
            message: `Mapeado place_id=${resolved.placeId} → EventoSuite.id=${resolved.idEventoSuite}.`,
            durationMs: Date.now() - started,
            implemented: true,
            code: 'MAPPED',
        };
    }

    async validateExistingReservation(
        ctx: ValidationContext
    ): Promise<ValidationStep> {
        const started = Date.now();
        const identity = {
            provider: IntegrationProvider.HOSPEDIN,
            entityType: IntegrationEntityType.RESERVATION,
            externalId: ctx.reservationId,
        };
        const state = await integrationSyncStateService.findByIdentity(identity);
        const internalId = state?.internal_entity_id
            ? Number(state.internal_entity_id)
            : null;

        if (!internalId || !Number.isFinite(internalId) || internalId <= 0) {
            return {
                rule: 'validateExistingReservation',
                success: true,
                message: 'Sem reserva Jango vinculada — candidato a CREATE.',
                durationMs: Date.now() - started,
                implemented: true,
                code: 'NEW',
            };
        }

        const { ReservaHospedagem } = await import(
            '../../../models/ReservaHospedagem'
        );
        const reserva = await ReservaHospedagem.findByPk(internalId);
        if (!reserva) {
            return {
                rule: 'validateExistingReservation',
                success: false,
                message: `internal_entity_id=${internalId} órfão (ReservaHospedagem inexistente).`,
                durationMs: Date.now() - started,
                implemented: true,
                code: 'INTERNAL_ENTITY_MISSING',
            };
        }

        const origem = String((reserva as any).origemReserva || '');
        if (origem !== 'HOSPEDIN') {
            return {
                rule: 'validateExistingReservation',
                success: false,
                message: `origemReserva=${origem || 'null'} — Hospedin não sobrescreve.`,
                durationMs: Date.now() - started,
                implemented: true,
                code: 'ORIGIN_CONFLICT',
            };
        }

        return {
            rule: 'validateExistingReservation',
            success: true,
            message: `Reserva Jango #${internalId} (HOSPEDIN) — candidato a UPDATE/CANCEL.`,
            durationMs: Date.now() - started,
            implemented: true,
            code: 'ALREADY_IMPORTED',
        };
    }

    validateDuplicates(_ctx: ValidationContext): ValidationStep {
        return this.notImplemented('validateDuplicates');
    }

    validateIntegrity(_ctx: ValidationContext): ValidationStep {
        return this.notImplemented('validateIntegrity');
    }

    // ─── Internos ───────────────────────────────────────────────

    private notImplemented(rule: string): ValidationStep {
        return {
            rule,
            success: true,
            message: NOT_IMPLEMENTED,
            durationMs: 0,
            implemented: false,
        };
    }

    private runRule(
        ctx: ValidationContext,
        ruleName: string,
        fn: () => ValidationStep
    ): ValidationStep {
        const step = fn();
        this.logRule(ctx.reservationId, step);
        return step;
    }

    private async runRuleAsync(
        ctx: ValidationContext,
        fn: () => Promise<ValidationStep>
    ): Promise<ValidationStep> {
        const step = await fn();
        this.logRule(ctx.reservationId, step);
        return step;
    }

    private logRule(reservationId: number, step: ValidationStep): void {
        HospedinLogger.info('validation:rule', {
            reservation_id: reservationId,
            rule: step.rule,
            success: step.success,
            implemented: step.implemented,
            durationMs: step.durationMs,
            message: step.message,
        });
    }

    private readPayload(
        row: HospedinReservation
    ): Record<string, unknown> | null {
        const raw = row.payload_json;
        if (!raw) return null;
        if (typeof raw === 'string') {
            try {
                return asRecord(JSON.parse(raw));
            } catch {
                return null;
            }
        }
        return asRecord(raw);
    }

    private async persistSyncStateFromValidation(
        result: ValidationResult,
        payload: unknown
    ): Promise<{
        state: Awaited<
            ReturnType<typeof integrationSyncStateService.findOrCreate>
        >;
        validationStatus: ValidationStatus;
    }> {
        const identity = {
            provider: IntegrationProvider.HOSPEDIN,
            entityType: IntegrationEntityType.RESERVATION,
            externalId: result.reservationId,
        };

        const existing = await integrationSyncStateService.findOrCreate(
            identity
        );

        // CANCEL é classificado antes do hash (nunca engolido por UNCHANGED).
        const payloadHash = integrationSyncStateService.hashPayload(payload);
        const suiteIgnoredStep = result.validations.find(
            (s) =>
                s.rule === 'validateSuiteMapping' && s.code === 'SUITE_IGNORED'
        );
        const suiteIgnored = Boolean(suiteIgnoredStep);
        const errorText =
            result.errors.length > 0
                ? result.errors.join('; ')
                : suiteIgnored
                  ? suiteIgnoredStep?.message ||
                    'Suíte ignorada por configuração'
                  : null;

        let finalValidation = result.status;
        if (
            finalValidation === 'ALREADY_IMPORTED' &&
            existing.payload_hash &&
            payloadHash &&
            existing.payload_hash === payloadHash
        ) {
            finalValidation = 'UNCHANGED';
        }

        await integrationSyncStateService.updateState({
            ...identity,
            syncStatus: IntegrationSyncStatus.VALIDATED,
            validationStatus: finalValidation,
            payloadHash,
            touchValidation: true,
            lastError: errorText,
            reason: `Validação concluída: ${finalValidation}`,
            operacao: 'sync_state_validated',
        });

        const finalStatus = this.mapValidationToSyncStatus(finalValidation);
        const errorCode =
            finalStatus === IntegrationSyncStatus.FAILED ||
            finalStatus === IntegrationSyncStatus.IGNORED ||
            finalStatus === IntegrationSyncStatus.WAIT_MAPPING
                ? normalizeSyncErrorCode(
                      suiteIgnored ? 'SUITE_IGNORED' : finalValidation,
                      errorText
                  )
                : null;

        let resolutionStatus: string | null = null;
        if (finalStatus === IntegrationSyncStatus.SYNCED) {
            resolutionStatus = SyncResolutionStatus.RESOLVED;
        } else if (
            finalStatus === IntegrationSyncStatus.IGNORED ||
            (errorCode &&
                isPermanentNonActionableError(errorCode, errorText))
        ) {
            resolutionStatus = SyncResolutionStatus.IGNORED;
        } else if (
            finalStatus === IntegrationSyncStatus.FAILED ||
            finalStatus === IntegrationSyncStatus.WAIT_MAPPING
        ) {
            resolutionStatus = SyncResolutionStatus.OPEN;
        }

        const effectiveSyncStatus =
            resolutionStatus === SyncResolutionStatus.IGNORED &&
            finalStatus === IntegrationSyncStatus.FAILED
                ? IntegrationSyncStatus.IGNORED
                : finalStatus;

        let state = await integrationSyncStateService.updateState({
            ...identity,
            syncStatus: effectiveSyncStatus,
            validationStatus: finalValidation,
            lastError:
                effectiveSyncStatus === IntegrationSyncStatus.FAILED ||
                effectiveSyncStatus === IntegrationSyncStatus.WAIT_MAPPING ||
                effectiveSyncStatus === IntegrationSyncStatus.IGNORED
                    ? errorText
                    : null,
            errorCode,
            errorSeverity: errorCode
                ? severityForErrorCode(errorCode)
                : null,
            resolutionStatus: resolutionStatus ?? undefined,
            clearNextRetry:
                resolutionStatus === SyncResolutionStatus.IGNORED ||
                resolutionStatus === SyncResolutionStatus.RESOLVED,
            reason:
                finalValidation === 'UNCHANGED'
                    ? 'Already synchronized (payload_hash igual).'
                    : `Estado pós-validação: ${effectiveSyncStatus}`,
            operacao: 'sync_state_after_validation',
        });

        const decision = reservationSyncOrchestrator.decideFromState(state);
        state = await integrationSyncStateService.updateState({
            ...identity,
            syncAction: decision.action,
            reason: decision.reason,
            operacao: 'sync_state_orchestrator_decision',
        });

        HospedinLogger.info('validation:sync_state', {
            reservation_id: result.reservationId,
            sync_state_id: state.id,
            correlation_id: state.correlation_id,
            validation_status: finalValidation,
            sync_status: state.sync_status,
            sync_action: state.sync_action,
            decision_reason: decision.reason,
        });

        if (suiteIgnored) {
            await recordEntitySyncEvent({
                provider: IntegrationProvider.HOSPEDIN,
                externalId: result.reservationId,
                internalEntityId: state.internal_entity_id,
                operation: 'VALIDATE',
                result: 'IGNORED',
                errorCode: SyncErrorCode.SUITE_IGNORED,
                errorSeverity: 'INFO',
                message:
                    errorText ||
                    'Suíte ignorada por configuração — fora da operação Jango.',
                correlationId: state.correlation_id,
            });
        }

        return { state, validationStatus: finalValidation };
    }

    private operacaoFromValidation(status: ValidationStatus): string {
        switch (status) {
            case 'UNCHANGED':
                return 'sync_unchanged';
            case 'ORIGIN_CONFLICT':
                return 'sync_conflict_origin';
            case 'CANCELLED':
                return 'validate_reservation_cancel';
            case 'ALREADY_IMPORTED':
                return 'validate_reservation_update';
            case 'READY_TO_SYNC':
                return 'validate_reservation_create';
            default:
                return 'validate_reservation';
        }
    }

    private messageFromValidation(status: ValidationStatus): string {
        switch (status) {
            case 'UNCHANGED':
                return 'Already synchronized';
            case 'ORIGIN_CONFLICT':
                return 'ORIGIN_CONFLICT — Hospedin não sobrescreve reserva de outra origem.';
            case 'CANCELLED':
                return 'CANCEL identificado na Validation (antes do hash).';
            case 'ALREADY_IMPORTED':
                return 'Candidato a UPDATE.';
            case 'READY_TO_SYNC':
                return 'Candidato a CREATE.';
            default:
                return `Validação: ${status}`;
        }
    }

    private mapValidationToSyncStatus(
        status: ValidationStatus
    ): IntegrationSyncStatusValue {
        switch (status) {
            case 'READY_TO_SYNC':
            case 'ALREADY_IMPORTED':
            case 'CANCELLED':
                return IntegrationSyncStatus.READY;
            case 'UNCHANGED':
                return IntegrationSyncStatus.SYNCED;
            case 'IGNORED':
                return IntegrationSyncStatus.IGNORED;
            case 'WAITING_SUITE_MAPPING':
                return IntegrationSyncStatus.WAIT_MAPPING;
            case 'ORIGIN_CONFLICT':
            case 'PAYLOAD_INVALID':
            case 'INVALID_STATUS':
            case 'INVALID_DATES':
            case 'ERROR':
            default:
                return IntegrationSyncStatus.FAILED;
        }
    }

    private buildResult(input: {
        reservationId: number;
        steps: ValidationStep[];
    }): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        for (const step of input.steps) {
            if (!step.implemented) {
                warnings.push(`${step.rule}: ${NOT_IMPLEMENTED}`);
                continue;
            }
            if (!step.success) {
                errors.push(`${step.rule}: ${step.message}`);
            }
        }

        const implementedFailed = input.steps.filter(
            (s) => s.implemented && !s.success
        );
        const payloadFailed = implementedFailed.some((s) =>
            ['validatePayload', 'validateRequiredFields', 'loadStaging'].includes(
                s.rule
            )
        );
        const suiteMappingFailed = implementedFailed.some(
            (s) => s.rule === 'validateSuiteMapping'
        );
        const datesFailed = implementedFailed.some(
            (s) => s.rule === 'validateDates'
        );
        const originConflict = implementedFailed.some(
            (s) => s.code === 'ORIGIN_CONFLICT'
        );
        const statusStep = input.steps.find(
            (s) => s.rule === 'validateReservationStatus' && s.implemented
        );
        const existingStep = input.steps.find(
            (s) => s.rule === 'validateExistingReservation' && s.implemented
        );

        let status: ValidationStatus;
        let ready = false;

        if (implementedFailed.some((s) => s.rule === 'loadStaging')) {
            status = 'ERROR';
        } else if (
            input.steps.some(
                (s) =>
                    s.rule === 'validateSuiteMapping' &&
                    s.code === 'SUITE_IGNORED'
            )
        ) {
            // Suíte deliberadamente fora da operação — sem pendência/retry.
            status = 'IGNORED';
            ready = false;
        } else if (payloadFailed) {
            status = 'PAYLOAD_INVALID';
        } else if (datesFailed) {
            status = 'INVALID_DATES';
        } else if (originConflict) {
            status = 'ORIGIN_CONFLICT';
        } else if (
            suiteMappingFailed &&
            statusStep?.code !== 'CANCELLED'
        ) {
            // CANCEL ainda precisa de mapa? Para cancelar, mapa não é obrigatório.
            // Se já importada, CANCEL segue; se não, erro de mapa impede CREATE.
            if (existingStep?.code === 'ALREADY_IMPORTED') {
                // suíte sumiu do mapa — ainda assim cancelamento deve seguir
                if (statusStep?.code === 'CANCELLED') {
                    status = 'CANCELLED';
                    ready = true;
                } else {
                    const suiteStep = implementedFailed.find(
                        (s) => s.rule === 'validateSuiteMapping'
                    );
                    status =
                        suiteStep?.code === 'WAITING_SUITE_MAPPING'
                            ? 'WAITING_SUITE_MAPPING'
                            : 'ERROR';
                }
            } else {
                const suiteStep = implementedFailed.find(
                    (s) => s.rule === 'validateSuiteMapping'
                );
                status =
                    suiteStep?.code === 'WAITING_SUITE_MAPPING'
                        ? 'WAITING_SUITE_MAPPING'
                        : 'ERROR';
            }
        } else if (statusStep?.code === 'CANCELLED') {
            // CANCEL antes de qualquer consideração de hash.
            status = 'CANCELLED';
            ready = existingStep?.code === 'ALREADY_IMPORTED';
            if (!ready) {
                // Cancelada na Hospedin sem nunca ter sido criada no Jango.
                status = 'IGNORED';
                ready = false;
            }
        } else if (statusStep?.code === 'IGNORED_STATUS') {
            status = 'IGNORED';
            ready = false;
        } else if (implementedFailed.length === 0) {
            if (existingStep?.code === 'ALREADY_IMPORTED') {
                status = 'ALREADY_IMPORTED';
                ready = true;
            } else {
                status = 'READY_TO_SYNC';
                ready = true;
            }
        } else {
            status = 'ERROR';
        }

        return {
            reservationId: input.reservationId,
            ready,
            status,
            errors,
            warnings,
            validations: input.steps,
        };
    }
}

export const hospedinReservationValidationService =
    new HospedinReservationValidationService();
