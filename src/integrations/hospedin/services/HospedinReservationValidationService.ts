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
    NOT_IMPLEMENTED,
    type ValidationResult,
    type ValidationStatus,
    type ValidationStep,
} from '../validation/types';
import { integrationSyncStateService } from './IntegrationSyncStateService';
import { hospedinSyncLogService } from './HospedinSyncLogService';
import { placeSuiteResolver } from './PlaceSuiteResolver';

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
            await this.persistSyncStateFromValidation(result, null);
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
            this.runRule(ctx, 'validateExistingReservation', () =>
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

        const syncState = await this.persistSyncStateFromValidation(
            result,
            ctx.payload
        );

        await hospedinSyncLogService.write({
            operacao: 'validate_reservation',
            endpoint: '/api/integrations/hospedin/validate/reservations',
            metodo: 'POST',
            request: { reservationId: id },
            response: {
                ready: result.ready,
                status: result.status,
                errors: result.errors,
                warnings: result.warnings,
                sync_state_id: syncState.id,
                correlation_id: syncState.correlation_id,
                sync_status: syncState.sync_status,
                sync_action: syncState.sync_action,
            },
            status: 200,
            duracaoMs: Date.now() - started,
            sucesso: true,
        });

        return result;
    }

    async validateAll(): Promise<{
        total: number;
        ready: number;
        results: ValidationResult[];
    }> {
        const rows = await HospedinReservation.findAll({
            attributes: ['reservation_id'],
            order: [['reservation_id', 'ASC']],
        });

        const results: ValidationResult[] = [];
        for (const row of rows) {
            results.push(
                await this.validateReservation(Number(row.reservation_id))
            );
        }

        return {
            total: results.length,
            ready: results.filter((r) => r.ready).length,
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

    // ─── Regras preparadas (futuras) ────────────────────────────

    validateReservationStatus(_ctx: ValidationContext): ValidationStep {
        return this.notImplemented('validateReservationStatus');
    }

    validateDates(_ctx: ValidationContext): ValidationStep {
        return this.notImplemented('validateDates');
    }

    validateGuests(_ctx: ValidationContext): ValidationStep {
        return this.notImplemented('validateGuests');
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

    validateExistingReservation(_ctx: ValidationContext): ValidationStep {
        return this.notImplemented('validateExistingReservation');
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
    ) {
        const identity = {
            provider: IntegrationProvider.HOSPEDIN,
            entityType: IntegrationEntityType.RESERVATION,
            externalId: result.reservationId,
        };

        await integrationSyncStateService.findOrCreate(identity);

        const payloadHash = integrationSyncStateService.hashPayload(payload);
        const errorText =
            result.errors.length > 0 ? result.errors.join('; ') : null;

        await integrationSyncStateService.updateState({
            ...identity,
            syncStatus: IntegrationSyncStatus.VALIDATED,
            validationStatus: result.status,
            payloadHash,
            touchValidation: true,
            lastError: errorText,
            reason: `Validação concluída: ${result.status}`,
            operacao: 'sync_state_validated',
        });

        const finalStatus = this.mapValidationToSyncStatus(result.status);
        let state = await integrationSyncStateService.updateState({
            ...identity,
            syncStatus: finalStatus,
            validationStatus: result.status,
            lastError:
                finalStatus === IntegrationSyncStatus.FAILED ? errorText : null,
            reason: `Estado pós-validação: ${finalStatus}`,
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
            validation_status: result.status,
            sync_status: state.sync_status,
            sync_action: state.sync_action,
            decision_reason: decision.reason,
        });

        return state;
    }

    private mapValidationToSyncStatus(
        status: ValidationStatus
    ): IntegrationSyncStatusValue {
        switch (status) {
            case 'READY_TO_SYNC':
            case 'ALREADY_IMPORTED':
            case 'CANCELLED':
                return IntegrationSyncStatus.READY;
            case 'WAITING_SUITE_MAPPING':
                return IntegrationSyncStatus.WAIT_MAPPING;
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
        const otherImplementedFailed = implementedFailed.filter(
            (s) =>
                ![
                    'validatePayload',
                    'validateRequiredFields',
                    'loadStaging',
                    'validateSuiteMapping',
                ].includes(s.rule)
        );

        let status: ValidationStatus;
        let ready = false;

        if (implementedFailed.some((s) => s.rule === 'loadStaging')) {
            status = 'ERROR';
        } else if (payloadFailed) {
            status = 'PAYLOAD_INVALID';
        } else if (
            suiteMappingFailed &&
            otherImplementedFailed.length === 0
        ) {
            const suiteStep = implementedFailed.find(
                (s) => s.rule === 'validateSuiteMapping'
            );
            status =
                suiteStep?.code === 'WAITING_SUITE_MAPPING'
                    ? 'WAITING_SUITE_MAPPING'
                    : 'ERROR';
        } else if (implementedFailed.length === 0) {
            status = 'READY_TO_SYNC';
            ready = true;
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
