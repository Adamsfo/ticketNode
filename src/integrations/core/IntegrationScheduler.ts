import { logger } from '../../utils/logger';
import { IntegrationProviderConfig } from '../../models/IntegrationProviderConfig';
import {
    IntegrationProviderRuntimeStatus,
    IntegrationProviderState,
} from '../../models/IntegrationProviderState';
import { IntegrationSyncTrigger } from '../../models/IntegrationSyncExecution';
import { ensureProviderConfigsFromRegistry } from './ProviderConfigService';
import { providerRegistry } from './ProviderRegistry';
import { providerRunLock } from './ProviderRunLock';
import { recoverDeadRuns } from './ProviderRunLifecycle';
import { runProviderCycle } from './SyncRunOrchestrator';

const TICK_MS = 30_000;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;

const log = logger.child('Scheduler');

/**
 * Scheduler genérico: tick → recoverDeadRuns → providers due → runCycle.
 */
export async function startIntegrationScheduler(): Promise<void> {
    await ensureProviderConfigsFromRegistry();

    const recovered = await recoverDeadRuns();
    if (recovered.recovered.length) {
        log.warn('Providers RUNNING mortos recuperados no boot', {
            providers: recovered.recovered,
        });
    }

    log.info('Integration Scheduler iniciado');
    for (const provider of providerRegistry.list()) {
        const config = await IntegrationProviderConfig.findOne({
            where: { provider: provider.id.toUpperCase() },
        });
        const state = await IntegrationProviderState.findOne({
            where: { provider: provider.id.toUpperCase() },
        });
        log.info(
            `Provider ${config?.displayName || provider.displayName}: ${
                config?.enabled ? 'habilitado' : 'desabilitado'
            } · intervalo ${config?.intervalMinutes ?? '?'} min · max ${
                config?.maxRunMinutes ?? 10
            } min · próxima ${
                state?.nextRunAt
                    ? new Date(state.nextRunAt).toISOString()
                    : '—'
            }`
        );
    }

    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => {
        void tickDueProviders();
    }, TICK_MS);

    setTimeout(() => {
        void tickDueProviders();
    }, 15_000);
}

export function stopIntegrationScheduler(): void {
    if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
    }
}

async function tickDueProviders(): Promise<void> {
    if (tickRunning) return;
    tickRunning = true;
    try {
        await recoverDeadRuns();

        const now = Date.now();
        const configs = await IntegrationProviderConfig.findAll({
            where: { enabled: true },
        });
        const due: Array<{
            provider: string;
            priority: number;
            isRetry: boolean;
        }> = [];

        for (const config of configs) {
            if (!providerRegistry.get(config.provider)) continue;
            const state = await IntegrationProviderState.findOne({
                where: { provider: config.provider },
            });
            if (!state) continue;

            if (state.status === IntegrationProviderRuntimeStatus.RUNNING) {
                // Vivo neste processo — skip. Mortos já foram liberados por recoverDeadRuns.
                continue;
            }
            if (providerRunLock.isLocked(config.provider)) continue;

            const next = state.nextRunAt
                ? new Date(state.nextRunAt).getTime()
                : 0;
            if (!state.nextRunAt || next <= now) {
                due.push({
                    provider: config.provider,
                    priority: config.priority,
                    isRetry: (state.consecutiveFailures || 0) > 0,
                });
            }
        }

        due.sort(
            (a, b) =>
                a.priority - b.priority || a.provider.localeCompare(b.provider)
        );

        for (const item of due) {
            await runProviderCycle(
                item.provider,
                item.isRetry
                    ? IntegrationSyncTrigger.RETRY
                    : IntegrationSyncTrigger.SCHEDULER
            );
        }
    } catch (error: any) {
        log.error('tick failed', {
            message: error?.message,
            stack: error?.stack,
        });
    } finally {
        tickRunning = false;
    }
}
