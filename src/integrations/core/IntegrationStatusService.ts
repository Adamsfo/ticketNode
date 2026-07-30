import { IntegrationProviderConfig } from '../../models/IntegrationProviderConfig';
import { IntegrationProviderState } from '../../models/IntegrationProviderState';
import { IntegrationSyncExecution } from '../../models/IntegrationSyncExecution';
import { providerRegistry } from './ProviderRegistry';
import { providerRunLock } from './ProviderRunLock';
import { getProviderScheduleConfig } from './ProviderConfigService';
import {
    getProviderExecutionStats,
    type ProviderExecutionStats,
} from './ExecutionHistoryService';

export type ProviderStatusView = {
    provider: string;
    displayName: string;
    enabled: boolean;
    intervalMinutes: number;
    mode: string;
    syncLimit: number;
    priority: number;
    maxRetries: number;
    backoffBaseSeconds: number;
    webhookEnabled: boolean;
    status: string;
    /** Status visual do dashboard. */
    uiStatus: 'executando' | 'aguardando' | 'erro' | 'desabilitado' | 'retry';
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
    nextRunAt: string | null;
    lastDurationMs: number | null;
    consecutiveFailures: number;
    lastExecution: {
        id: number;
        status: string;
        triggerSource: string;
        startedAt: string;
        finishedAt: string | null;
        durationMs: number | null;
        imported: number | null;
        validated: number | null;
        validatedReady: number | null;
        validatedIgnored: number | null;
        created: number | null;
        updated: number | null;
        cancelled: number | null;
        failed: number | null;
        skipped: number | null;
        unchanged: number | null;
        errorMessage: string | null;
    } | null;
    /** Agregados de integration_sync_execution (COUNT/AVG). */
    executionStats: ProviderExecutionStats | null;
    registered: boolean;
};

function toIso(d?: Date | string | null): string | null {
    if (!d) return null;
    try {
        return new Date(d).toISOString();
    } catch {
        return null;
    }
}

function mapUiStatus(input: {
    enabled: boolean;
    status: string;
    locked: boolean;
}): ProviderStatusView['uiStatus'] {
    if (!input.enabled || input.status === 'DISABLED') return 'desabilitado';
    if (input.locked || input.status === 'RUNNING') return 'executando';
    if (input.status === 'WAITING_RETRY') return 'retry';
    if (input.status === 'ERROR') return 'erro';
    return 'aguardando';
}

/**
 * Visão agregada para dashboard / monitoramento (genérica por provider).
 */
export async function listIntegrationsStatus(): Promise<ProviderStatusView[]> {
    const registeredIds = new Set(providerRegistry.ids());
    const configs = await IntegrationProviderConfig.findAll({
        order: [
            ['priority', 'ASC'],
            ['provider', 'ASC'],
        ],
    });

    const views: ProviderStatusView[] = [];

    for (const config of configs) {
        const state = await IntegrationProviderState.findOne({
            where: { provider: config.provider },
        });
        const lastExec = state?.lastExecutionId
            ? await IntegrationSyncExecution.findByPk(state.lastExecutionId)
            : await IntegrationSyncExecution.findOne({
                  where: { provider: config.provider },
                  order: [['startedAt', 'DESC']],
              });

        const locked = providerRunLock.isLocked(config.provider);
        const status = state?.status || 'IDLE';
        let executionStats: ProviderExecutionStats | null = null;
        try {
            executionStats = await getProviderExecutionStats(config.provider);
        } catch {
            executionStats = null;
        }

        views.push({
            provider: config.provider,
            displayName: config.displayName,
            enabled: Boolean(config.enabled),
            intervalMinutes: config.intervalMinutes,
            mode: config.mode,
            syncLimit: config.syncLimit,
            priority: config.priority,
            maxRetries: config.maxRetries,
            backoffBaseSeconds: config.backoffBaseSeconds,
            webhookEnabled: Boolean(config.webhookEnabled),
            status,
            uiStatus: mapUiStatus({
                enabled: Boolean(config.enabled),
                status,
                locked,
            }),
            lastStartedAt: toIso(state?.lastStartedAt),
            lastFinishedAt: toIso(state?.lastFinishedAt),
            lastSuccessAt: toIso(state?.lastSuccessAt),
            lastErrorAt: toIso(state?.lastErrorAt),
            lastErrorMessage: state?.lastErrorMessage ?? null,
            nextRunAt: toIso(state?.nextRunAt),
            lastDurationMs: state?.lastDurationMs ?? null,
            consecutiveFailures: state?.consecutiveFailures ?? 0,
            lastExecution: lastExec
                ? {
                      id: lastExec.id,
                      status: String(lastExec.status),
                      triggerSource: String(lastExec.triggerSource),
                      startedAt: toIso(lastExec.startedAt) || '',
                      finishedAt: toIso(lastExec.finishedAt),
                      durationMs: lastExec.durationMs ?? null,
                      imported: lastExec.imported ?? null,
                      validated: lastExec.validated ?? null,
                      validatedReady: lastExec.validatedReady ?? null,
                      validatedIgnored: lastExec.validatedIgnored ?? null,
                      created: lastExec.createdCount ?? null,
                      updated: lastExec.updatedCount ?? null,
                      cancelled: lastExec.cancelledCount ?? null,
                      failed: lastExec.failedCount ?? null,
                      skipped: lastExec.skippedCount ?? null,
                      unchanged: lastExec.unchangedCount ?? null,
                      errorMessage: lastExec.errorMessage ?? null,
                  }
                : null,
            executionStats,
            registered: registeredIds.has(config.provider.toUpperCase()),
        });
    }

    // Providers registrados sem config ainda (edge)
    for (const provider of providerRegistry.list()) {
        if (views.some((v) => v.provider === provider.id.toUpperCase())) {
            continue;
        }
        const cfg = await getProviderScheduleConfig(provider.id);
        views.push({
            provider: provider.id.toUpperCase(),
            displayName: provider.displayName,
            enabled: cfg?.enabled ?? false,
            intervalMinutes: cfg?.intervalMinutes ?? 5,
            mode: cfg?.mode ?? 'incremental',
            syncLimit: cfg?.syncLimit ?? 50,
            priority: cfg?.priority ?? 100,
            maxRetries: cfg?.maxRetries ?? 2,
            backoffBaseSeconds: cfg?.backoffBaseSeconds ?? 30,
            webhookEnabled: cfg?.webhookEnabled ?? false,
            status: 'IDLE',
            uiStatus: 'desabilitado',
            lastStartedAt: null,
            lastFinishedAt: null,
            lastSuccessAt: null,
            lastErrorAt: null,
            lastErrorMessage: null,
            nextRunAt: null,
            lastDurationMs: null,
            consecutiveFailures: 0,
            lastExecution: null,
            executionStats: null,
            registered: true,
        });
    }

    return views;
}
