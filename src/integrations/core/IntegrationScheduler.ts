import { IntegrationProviderConfig } from '../../models/IntegrationProviderConfig';
import {
    IntegrationProviderRuntimeStatus,
    IntegrationProviderState,
} from '../../models/IntegrationProviderState';
import { IntegrationSyncTrigger } from '../../models/IntegrationSyncExecution';
import { ensureProviderConfigsFromRegistry } from './ProviderConfigService';
import { providerRegistry } from './ProviderRegistry';
import { providerRunLock } from './ProviderRunLock';
import { runProviderCycle } from './SyncRunOrchestrator';

const TICK_MS = 30_000;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;

/**
 * Scheduler genérico: tick curto → providers due (por prioridade) → runCycle.
 * Sem regra de negócio de PMS.
 */
export async function startIntegrationScheduler(): Promise<void> {
    await ensureProviderConfigsFromRegistry();

    console.log('Integration Scheduler iniciado');
    for (const provider of providerRegistry.list()) {
        const config = await IntegrationProviderConfig.findOne({
            where: { provider: provider.id.toUpperCase() },
        });
        const state = await IntegrationProviderState.findOne({
            where: { provider: provider.id.toUpperCase() },
        });
        console.log(
            [
                `Provider: ${config?.displayName || provider.displayName}`,
                `Habilitado: ${config?.enabled ? 'sim' : 'não'}`,
                `Intervalo: ${config?.intervalMinutes ?? '?'} minutos`,
                `Prioridade: ${config?.priority ?? 100}`,
                `Próxima execução: ${
                    state?.nextRunAt
                        ? new Date(state.nextRunAt).toISOString()
                        : '—'
                }`,
            ].join(' | ')
        );
    }

    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => {
        void tickDueProviders();
    }, TICK_MS);

    // Primeiro tick após 15s (evita pico no boot).
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
                    isRetry:
                        state.status ===
                        IntegrationProviderRuntimeStatus.WAITING_RETRY,
                });
            }
        }

        due.sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider));

        for (const item of due) {
            await runProviderCycle(
                item.provider,
                item.isRetry
                    ? IntegrationSyncTrigger.RETRY
                    : IntegrationSyncTrigger.SCHEDULER
            );
        }
    } catch (error) {
        console.error('[IntegrationScheduler] tick failed', error);
    } finally {
        tickRunning = false;
    }
}
