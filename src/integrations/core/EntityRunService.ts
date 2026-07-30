import {
    IntegrationEntityType,
    IntegrationProvider,
    IntegrationSyncStatus,
} from '../../models/IntegrationSyncState';
import { integrationSyncStateService } from '../hospedin/services/IntegrationSyncStateService';
import { hospedinReservationValidationService } from '../hospedin/services/HospedinReservationValidationService';
import { reservationSyncRunner } from '../hospedin/sync/ReservationSyncRunner';
import { importHospedinReservations } from '../hospedin/services/HospedinImportReservationService';
import { recordEntitySyncEvent } from './EntitySyncEventService';
import {
    computeSmartRetryAt,
    isTransientErrorCode,
    normalizeSyncErrorCode,
    resolutionForFailure,
    severityForErrorCode,
    SyncResolutionStatus,
} from './syncErrorClassification';
import { newCorrelationId } from './ProviderConfigService';

/**
 * Reprocessa uma reserva pelo pipeline oficial (validate + sync),
 * opcionalmente com refresh de import.
 * Usado por: botão no modal, Pendências, retry inteligente.
 */
export async function runEntitySync(input: {
    provider: string;
    externalId: string | number;
    refreshImport?: boolean;
    trigger?: string;
}): Promise<{
    ok: boolean;
    externalId: string;
    correlationId: string;
    validateReady?: boolean;
    syncResult?: unknown;
    errorMessage?: string | null;
}> {
    const provider = String(input.provider || '').toUpperCase();
    const externalId = String(input.externalId);
    const correlationId = newCorrelationId(`${provider.toLowerCase()}-entity`);
    const started = Date.now();

    if (provider !== IntegrationProvider.HOSPEDIN) {
        return {
            ok: false,
            externalId,
            correlationId,
            errorMessage: `Provider ${provider} ainda não implementa run por entidade.`,
        };
    }

    try {
        if (input.refreshImport) {
            // Import completo incremental — mesmo serviço do scheduler.
            // (Hospedin não tem import por id estável na API atual.)
            await importHospedinReservations({
                fetchDetails: false,
                mode: 'incremental',
            });
        }

        const validation =
            await hospedinReservationValidationService.validateReservation(
                Number(externalId)
            );

        let syncResult: unknown = null;
        if (validation.ready) {
            syncResult = await reservationSyncRunner.processOne(
                Number(externalId)
            );
        } else {
            // Garante estado persistido com classificação
            const state = await integrationSyncStateService.findByIdentity({
                provider,
                entityType: IntegrationEntityType.RESERVATION,
                externalId,
            });
            if (state) {
                const code = normalizeSyncErrorCode(
                    validation.status,
                    validation.errors?.join('; ') || state.last_error
                );
                const severity = severityForErrorCode(code);
                const retryCount = Number(state.retry_count || 0);
                const nextRetryAt = isTransientErrorCode(code)
                    ? computeSmartRetryAt(retryCount)
                    : null;
                await integrationSyncStateService.updateState({
                    provider,
                    entityType: IntegrationEntityType.RESERVATION,
                    externalId,
                    errorCode: code,
                    errorSeverity: severity,
                    nextRetryAt,
                    lastError:
                        validation.errors?.join('; ') || state.last_error,
                    reason: 'Classificação pós-validate (entity run)',
                });
            }
        }

        const ok =
            Boolean(validation.ready) &&
            (syncResult == null ||
                (typeof syncResult === 'object' &&
                    (syncResult as any).ok !== false));

        await recordEntitySyncEvent({
            provider,
            externalId,
            operation: (syncResult as any)?.action || 'VALIDATE',
            result: ok ? 'SUCCESS' : 'ERROR',
            message: ok
                ? 'Reprocessamento concluído'
                : validation.errors?.join('; ') || 'Falha no reprocessamento',
            durationMs: Date.now() - started,
            correlationId,
            errorCode: ok
                ? null
                : normalizeSyncErrorCode(
                      validation.status,
                      validation.errors?.[0]
                  ),
            errorSeverity: ok
                ? null
                : severityForErrorCode(
                      normalizeSyncErrorCode(
                          validation.status,
                          validation.errors?.[0]
                      )
                  ),
            internalEntityId: (syncResult as any)?.internalEntityId ?? null,
        });

        return {
            ok,
            externalId,
            correlationId,
            validateReady: validation.ready,
            syncResult,
            errorMessage: ok
                ? null
                : validation.errors?.join('; ') || 'Falha no reprocessamento',
        };
    } catch (error: any) {
        const message = error?.message || 'Erro no reprocessamento da entidade.';
        const code = normalizeSyncErrorCode(error?.code, message);
        const severity = severityForErrorCode(code);

        const state = await integrationSyncStateService.findByIdentity({
            provider,
            entityType: IntegrationEntityType.RESERVATION,
            externalId,
        });
        const retryCount = Number(state?.retry_count || 0);
        const nextRetryAt = isTransientErrorCode(code)
            ? computeSmartRetryAt(retryCount)
            : null;

        await integrationSyncStateService.markError({
            provider,
            entityType: IntegrationEntityType.RESERVATION,
            externalId,
            error: message,
            errorCode: code,
            errorSeverity: severity,
            nextRetryAt,
            reason: `entity_run:${input.trigger || 'manual'}`,
        });

        await recordEntitySyncEvent({
            provider,
            externalId,
            operation: 'SYNC',
            result: 'ERROR',
            errorCode: code,
            errorSeverity: severity,
            message,
            durationMs: Date.now() - started,
            correlationId,
        });

        return {
            ok: false,
            externalId,
            correlationId,
            errorMessage: message,
        };
    }
}

export async function runEntitySyncBulk(input: {
    provider: string;
    externalIds: Array<string | number>;
    refreshImport?: boolean;
}): Promise<{
    total: number;
    ok: number;
    failed: number;
    results: Array<Awaited<ReturnType<typeof runEntitySync>>>;
}> {
    const results = [];
    let ok = 0;
    let failed = 0;
    for (const id of input.externalIds) {
        const r = await runEntitySync({
            provider: input.provider,
            externalId: id,
            refreshImport: input.refreshImport === true && results.length === 0,
            trigger: 'BULK',
        });
        results.push(r);
        if (r.ok) ok += 1;
        else failed += 1;
    }
    return { total: results.length, ok, failed, results };
}

/** Após falha no executor — aplica classificação + smart retry / ignore permanente. */
export async function applyFailureClassification(input: {
    provider: string;
    externalId: string | number;
    rawCode?: string | null;
    message: string;
    syncStatus?: string;
    validationStatus?: string | null;
    incrementRetry?: boolean;
}): Promise<void> {
    const code = normalizeSyncErrorCode(input.rawCode, input.message);
    const severity = severityForErrorCode(code);
    const resolution = resolutionForFailure({
        code,
        message: input.message,
    });

    if (resolution === SyncResolutionStatus.IGNORED) {
        await integrationSyncStateService.markIgnored({
            provider: input.provider,
            entityType: IntegrationEntityType.RESERVATION,
            externalId: input.externalId,
            error: input.message,
            errorCode: code,
            reason: `Ignorado (sem ação operacional): ${code}`,
        });
        return;
    }

    const state = await integrationSyncStateService.findByIdentity({
        provider: input.provider,
        entityType: IntegrationEntityType.RESERVATION,
        externalId: input.externalId,
    });
    const nextCount = Number(state?.retry_count || 0) + 1;
    const nextRetryAt = isTransientErrorCode(code)
        ? computeSmartRetryAt(nextCount - 1)
        : null;

    if (input.syncStatus === IntegrationSyncStatus.WAIT_MAPPING) {
        await integrationSyncStateService.updateState({
            provider: input.provider,
            entityType: IntegrationEntityType.RESERVATION,
            externalId: input.externalId,
            syncStatus: IntegrationSyncStatus.WAIT_MAPPING,
            validationStatus: input.validationStatus || 'WAITING_SUITE_MAPPING',
            lastError: input.message,
            errorCode: SyncErrorCodeWaitMapping(code),
            errorSeverity: severityForErrorCode(
                SyncErrorCodeWaitMapping(code)
            ),
            resolutionStatus: SyncResolutionStatus.OPEN,
            nextRetryAt: null,
            incrementRetry: input.incrementRetry !== false,
            reason: input.message,
            operacao: 'sync_state_wait_mapping',
        });
        return;
    }

    await integrationSyncStateService.markError({
        provider: input.provider,
        entityType: IntegrationEntityType.RESERVATION,
        externalId: input.externalId,
        error: input.message,
        errorCode: code,
        errorSeverity: severity,
        resolutionStatus: SyncResolutionStatus.OPEN,
        nextRetryAt,
        validationStatus: input.validationStatus,
        reason: input.message,
    });
}

function SyncErrorCodeWaitMapping(code: string): string {
    return code === 'ROOM_MAPPING_NOT_FOUND' ? code : 'WAIT_MAPPING';
}
