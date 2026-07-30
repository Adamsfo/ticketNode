import {
    IntegrationProviderRuntimeStatus,
    IntegrationProviderState,
} from '../../models/IntegrationProviderState';
import {
    IntegrationSyncExecution,
    IntegrationSyncExecutionStatus,
    IntegrationSyncTrigger,
    type IntegrationSyncTriggerValue,
} from '../../models/IntegrationSyncExecution';
import {
    createRunningExecution,
    createSkippedExecution,
    finishExecution,
    resolveExecutionStatus,
} from './ExecutionHistoryService';
import {
    getProviderScheduleConfig,
    newCorrelationId,
} from './ProviderConfigService';
import { providerRegistry } from './ProviderRegistry';
import { providerRunLock } from './ProviderRunLock';
import {
    computeBackoffMs,
    type SyncRunContext,
    type SyncRunSummary,
} from './types';

export type RunProviderResult = {
    skipped: boolean;
    reason?: string;
    executionId?: number;
    summary?: SyncRunSummary;
    correlationId: string;
};

function logLine(provider: string, message: string, extra?: unknown): void {
    const prefix = `[IntegrationSync][${provider}]`;
    if (extra !== undefined) {
        console.log(prefix, message, extra);
    } else {
        console.log(prefix, message);
    }
}

/**
 * Orquestra um ciclo completo: lock → histórico → runCycle → estado → next_run.
 * Usado por scheduler, botão manual, API e webhook.
 */
export async function runProviderCycle(
    providerId: string,
    trigger: IntegrationSyncTriggerValue | string = IntegrationSyncTrigger.SCHEDULER,
    options?: {
        mode?: string;
        syncLimit?: number;
        webhookPayload?: unknown;
        correlationId?: string;
        /** Manual/API/webhook podem forçar mesmo se disabled (admin). */
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

    if (!providerRunLock.tryAcquire(id)) {
        logLine(id, 'Sincronização ignorada — execução anterior ainda em andamento.');
        const skipped = await createSkippedExecution({
            provider: id,
            trigger,
            correlationId,
            reason: 'Execução anterior ainda em andamento.',
        });
        return {
            skipped: true,
            reason: 'Execução anterior ainda em andamento.',
            executionId: skipped.id,
            correlationId,
        };
    }

    let executionId: number | undefined;
    try {
        const mode = options?.mode || config.mode || 'incremental';
        const syncLimit = options?.syncLimit ?? config.syncLimit;

        const state =
            (await IntegrationProviderState.findOne({
                where: { provider: id },
            })) ||
            (await IntegrationProviderState.create({
                provider: id,
                status: IntegrationProviderRuntimeStatus.RUNNING,
                consecutiveFailures: 0,
            }));

        await state.update({
            status: IntegrationProviderRuntimeStatus.RUNNING,
            lastStartedAt: new Date(),
            lastErrorMessage: null,
        });

        const execution = await createRunningExecution({
            provider: id,
            trigger,
            mode,
            correlationId,
        });
        executionId = execution.id;
        await state.update({ lastExecutionId: execution.id });

        logLine(id, 'Início', {
            trigger,
            mode,
            syncLimit,
            correlationId,
        });

        const ctx: SyncRunContext = {
            trigger,
            correlationId,
            mode,
            syncLimit,
            webhookPayload: options?.webhookPayload,
        };

        const summary = await provider.runCycle(ctx);
        const execStatus = resolveExecutionStatus(summary);
        await finishExecution(execution, summary, execStatus);

        const finishedAt = new Date();
        const durationMs = execution.durationMs ?? 0;

        logLine(id, 'Resumo', {
            Import: summary.imported ?? 0,
            Validate: `${summary.validatedReady ?? 0} válidas / ${summary.validatedIgnored ?? 0} ignoradas`,
            Sync: `${summary.created ?? 0} CREATE / ${summary.updated ?? 0} UPDATE / ${summary.cancelled ?? 0} CANCEL / ${summary.unchanged ?? 0} sem alterações / ${summary.failed ?? 0} falhas`,
            Tempo: `${Math.round(durationMs / 1000)}s`,
        });
        logLine(id, 'Fim', { status: execStatus });

        if (execStatus === IntegrationSyncExecutionStatus.FAILED) {
            const failures = (state.consecutiveFailures || 0) + 1;
            const useRetry =
                failures <= config.maxRetries && config.maxRetries > 0;
            const backoffMs = computeBackoffMs(
                failures,
                config.backoffBaseSeconds
            );
            const nextRunAt = useRetry
                ? new Date(Date.now() + backoffMs)
                : new Date(Date.now() + config.intervalMinutes * 60_000);

            await state.update({
                status: useRetry
                    ? IntegrationProviderRuntimeStatus.WAITING_RETRY
                    : IntegrationProviderRuntimeStatus.ERROR,
                lastFinishedAt: finishedAt,
                lastErrorAt: finishedAt,
                lastErrorMessage: summary.errorMessage || 'Falha no ciclo.',
                lastDurationMs: durationMs,
                consecutiveFailures: failures,
                nextRunAt,
                lastExecutionId: execution.id,
            });

            if (useRetry) {
                logLine(id, 'Retry agendado', {
                    attempt: failures,
                    nextRunAt: nextRunAt.toISOString(),
                    backoffMs,
                });
            }
        } else {
            const nextRunAt = new Date(
                Date.now() + config.intervalMinutes * 60_000
            );
            await state.update({
                status: config.enabled
                    ? IntegrationProviderRuntimeStatus.IDLE
                    : IntegrationProviderRuntimeStatus.DISABLED,
                lastFinishedAt: finishedAt,
                lastSuccessAt: finishedAt,
                lastErrorAt:
                    execStatus === IntegrationSyncExecutionStatus.PARTIAL
                        ? finishedAt
                        : state.lastErrorAt,
                lastErrorMessage:
                    execStatus === IntegrationSyncExecutionStatus.PARTIAL
                        ? summary.errorMessage ||
                          `${summary.failed || 0} falha(s) no lote`
                        : null,
                lastDurationMs: durationMs,
                consecutiveFailures: 0,
                nextRunAt: config.enabled ? nextRunAt : null,
                lastExecutionId: execution.id,
            });
        }

        return {
            skipped: false,
            executionId,
            summary,
            correlationId,
        };
    } catch (error: any) {
        const message =
            error?.message || 'Erro inesperado no ciclo de sincronização.';
        logLine(id, 'Erro', message);

        if (executionId) {
            const execution = await IntegrationSyncExecution.findByPk(
                executionId
            );
            if (execution) {
                await finishExecution(
                    execution,
                    { ok: false, errorMessage: message },
                    IntegrationSyncExecutionStatus.FAILED
                );
            }
        }

        const state = await IntegrationProviderState.findOne({
            where: { provider: id },
        });
        if (state) {
            const failures = (state.consecutiveFailures || 0) + 1;
            const useRetry =
                failures <= (config?.maxRetries ?? 2) &&
                (config?.maxRetries ?? 2) > 0;
            const backoffMs = computeBackoffMs(
                failures,
                config?.backoffBaseSeconds ?? 30
            );
            const nextRunAt = useRetry
                ? new Date(Date.now() + backoffMs)
                : new Date(
                      Date.now() +
                          (config?.intervalMinutes ?? 5) * 60_000
                  );
            await state.update({
                status: useRetry
                    ? IntegrationProviderRuntimeStatus.WAITING_RETRY
                    : IntegrationProviderRuntimeStatus.ERROR,
                lastFinishedAt: new Date(),
                lastErrorAt: new Date(),
                lastErrorMessage: message,
                consecutiveFailures: failures,
                nextRunAt,
            });
        }

        return {
            skipped: false,
            executionId,
            summary: { ok: false, errorMessage: message },
            correlationId,
        };
    } finally {
        providerRunLock.release(id);
    }
}