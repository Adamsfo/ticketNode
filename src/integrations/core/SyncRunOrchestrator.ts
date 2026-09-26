/**
 * Orquestra um ciclo: validações → startRun → runCycle → finishRun (finally).
 *
 * Toda mutação de status RUNNING/IDLE passa por ProviderRunLifecycle.
 */

import {
    logger,
    logOperationalError,
    logSchedulerSummary,
} from '../../utils/logger';
import { IntegrationSyncTrigger } from '../../models/IntegrationSyncExecution';
import type { IntegrationSyncTriggerValue } from '../../models/IntegrationSyncExecution';
import { resolveExecutionStatus } from './ExecutionHistoryService';
import {
    getProviderScheduleConfig,
    newCorrelationId,
} from './ProviderConfigService';
import {
    finishRun,
    mapOutcomeToFinishKind,
    recoverDeadRuns,
    startRun,
    type ActiveRunHandle,
} from './ProviderRunLifecycle';
import { providerRegistry } from './ProviderRegistry';
import { providerRunLock } from './ProviderRunLock';
import type { SyncRunContext, SyncRunSummary } from './types';

export type RunProviderResult = {
    skipped: boolean;
    reason?: string;
    executionId?: number;
    summary?: SyncRunSummary;
    correlationId: string;
};

export {
    recoverDeadRuns as recoverStaleRunningProviders,
    recoverDeadRuns,
    isProviderRunAlive,
    isStaleRunning,
    HEARTBEAT_INTERVAL_MS,
    HEARTBEAT_TTL_MS,
    DEFAULT_MAX_RUN_MS,
} from './ProviderRunLifecycle';

/** Alias histórico (watchdog padrão = max run). */
export { DEFAULT_MAX_RUN_MS as STALE_RUNNING_MS } from './ProviderRunLifecycle';

const log = logger.child('IntegrationSync');

/**
 * Ciclo completo. Garantia: se startRun rodou, finishRun roda no finally.
 */
export async function runProviderCycle(
    providerId: string,
    trigger: IntegrationSyncTriggerValue | string = IntegrationSyncTrigger.SCHEDULER,
    options?: {
        mode?: string;
        syncLimit?: number;
        webhookPayload?: unknown;
        correlationId?: string;
        force?: boolean;
    }
): Promise<RunProviderResult> {
    const id = String(providerId || '')
        .trim()
        .toUpperCase();
    const correlationId =
        options?.correlationId || newCorrelationId(id.toLowerCase());

    const provider = providerRegistry.get(id);
    if (!provider) {
        return {
            skipped: true,
            reason: `Provider ${id} não registrado.`,
            correlationId,
        };
    }

    const config = await getProviderScheduleConfig(id);
    if (!config) {
        return {
            skipped: true,
            reason: `Config ausente para ${id}.`,
            correlationId,
        };
    }

    const isManualLike =
        trigger === IntegrationSyncTrigger.MANUAL ||
        trigger === IntegrationSyncTrigger.API ||
        trigger === IntegrationSyncTrigger.WEBHOOK ||
        Boolean(options?.force);

    if (!config.enabled && !isManualLike) {
        return {
            skipped: true,
            reason: 'Provider desabilitado.',
            correlationId,
        };
    }

    const ctx: SyncRunContext = {
        trigger,
        correlationId,
        mode: options?.mode || config.mode || 'incremental',
        syncLimit: options?.syncLimit ?? config.syncLimit,
        webhookPayload: options?.webhookPayload,
    };

    // Antes de tentar lock: recupera RUNNING morto deste provider (heartbeat).
    await recoverDeadRuns();

    if (typeof provider.shouldStartCycle === 'function') {
        const gate = await provider.shouldStartCycle(ctx, config);
        if (!gate.start) {
            log.debug(`${id}: ciclo omitido — sem trabalho processável`, {
                reason: gate.reason,
                trigger,
            });
            return {
                skipped: true,
                reason: gate.reason || 'Sem trabalho processável.',
                correlationId,
            };
        }
    }

    if (providerRunLock.isLocked(id)) {
        log.warn(
            `${id}: sincronização ignorada — execução anterior em andamento`
        );
        return {
            skipped: true,
            reason: 'Execução anterior ainda em andamento.',
            correlationId,
        };
    }

    if (typeof provider.preflightCycle === 'function') {
        const pre = await provider.preflightCycle(ctx, config);
        if (!pre.start) {
            log.debug(`${id}: ciclo omitido após preflight`, {
                reason: pre.reason,
                trigger,
            });
            return {
                skipped: true,
                reason: pre.reason || 'Preflight: sem trabalho após import.',
                correlationId,
            };
        }
    }

    let handle: ActiveRunHandle | null = null;
    let summary: SyncRunSummary | null = null;
    let cycleError: string | null = null;

    try {
        const mode = ctx.mode || 'incremental';
        const syncLimit = ctx.syncLimit ?? config.syncLimit;

        handle = await startRun({
            provider: id,
            trigger,
            mode,
            correlationId,
            config,
        });

        log.info(`${provider.displayName || id}: sincronização iniciada`, {
            trigger,
            mode,
            syncLimit,
        });

        summary = await provider.runCycle(ctx);

        // Se watchdog já abortou, não sobrescrever.
        if (handle.finished) {
            return {
                skipped: false,
                executionId: handle.execution.id,
                summary: {
                    ok: false,
                    errorMessage: 'Execução abortada pelo watchdog.',
                },
                correlationId,
            };
        }

        const execStatus = resolveExecutionStatus(summary);
        try {
            const ignored =
                Number(summary.validatedIgnored || 0) +
                Number(summary.skipped || 0);
            logSchedulerSummary({
                provider: provider.displayName || id,
                imported: summary.imported,
                validated: summary.validated,
                created: summary.created,
                updated: summary.updated,
                cancelled: summary.cancelled,
                ignored,
                failed: summary.failed,
                durationMs: Date.now() - handle.startedAt.getTime(),
                status: execStatus,
            });
        } catch {
            /* best-effort */
        }

        return {
            skipped: false,
            executionId: handle.execution.id,
            summary,
            correlationId,
        };
    } catch (error: any) {
        const message =
            error?.message || 'Erro inesperado no ciclo de sincronização.';
        cycleError = message;
        logOperationalError({
            provider: id,
            stage: 'CYCLE',
            message,
            stack: error?.stack,
        });
        return {
            skipped: false,
            executionId: handle?.execution?.id,
            summary: { ok: false, errorMessage: message },
            correlationId,
        };
    } finally {
        if (handle && !handle.finished) {
            try {
                if (cycleError) {
                    await finishRun({
                        handle,
                        kind: 'ERROR',
                        errorMessage: cycleError,
                        summary: {
                            ok: false,
                            errorMessage: cycleError,
                        },
                    });
                } else if (summary) {
                    const execStatus = resolveExecutionStatus(summary);
                    await finishRun({
                        handle,
                        kind: mapOutcomeToFinishKind(execStatus),
                        summary,
                    });
                } else {
                    await finishRun({
                        handle,
                        kind: 'ABORTED',
                        errorMessage:
                            'Ciclo interrompido sem resultado — forçado IDLE.',
                    });
                }
            } catch (finErr: any) {
                logOperationalError({
                    provider: id,
                    stage: 'FINALIZE',
                    message:
                        finErr?.message ||
                        'Falha no finishRun — lock será liberado.',
                    stack: finErr?.stack,
                });
                providerRunLock.release(id);
            }
        }
    }
}
