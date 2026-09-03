import { logger } from '../../../utils/logger';
import {
    IntegrationProviderRuntimeStatus,
    IntegrationProviderState,
} from '../../../models/IntegrationProviderState';
import { IntegrationSyncTrigger } from '../../../models/IntegrationSyncExecution';
import type { ProviderScheduleConfig } from '../../core/types';
import { getProviderScheduleConfig } from '../../core/ProviderConfigService';
import { providerRunLock } from '../../core/ProviderRunLock';
import { runProviderCycle } from '../../core/SyncRunOrchestrator';
import type { RunProviderResult } from '../../core/SyncRunOrchestrator';
import { hospedinOutboundStateService } from './HospedinOutboundStateService';
import {
    countClaimableOutbound,
    HOSPEDIN_OUTBOUND_PROVIDER_ID,
    setOutboundHasPendingTrue,
    tryClearOutboundPendingIfIdle,
} from './hospedinOutboundQueueProbe';

const log = logger.child('HospedinOutboundDispatcher');

export type OutboundDispatchTrigger = 'signal' | 'watchdog';

let dispatchRunning = false;
let pendingTailDispatch = false;

export type OutboundDispatcherTestDeps = {
    runProviderCycle?: (
        providerId: string,
        trigger: string,
        options?: Record<string, unknown>
    ) => Promise<RunProviderResult>;
    getProviderScheduleConfig?: (
        providerId: string
    ) => Promise<ProviderScheduleConfig | null>;
    /** Testes: executa dispatch de forma síncrona/awaitable. */
    synchronousSchedule?: boolean;
    /** Testes: não agenda dispatch após sinalizar (simula falha no trigger). */
    suppressSchedule?: boolean;
};

let dispatcherTestDeps: OutboundDispatcherTestDeps = {};

function resolveGetProviderScheduleConfig() {
    return (
        dispatcherTestDeps.getProviderScheduleConfig ?? getProviderScheduleConfig
    );
}

function resolveRunProviderCycle() {
    return dispatcherTestDeps.runProviderCycle ?? runProviderCycle;
}

export function _setOutboundDispatcherTestDeps(
    deps: OutboundDispatcherTestDeps
): void {
    dispatcherTestDeps = { ...dispatcherTestDeps, ...deps };
}

/**
 * Marca has_pending e agenda processamento assíncrono (não bloqueia escrita).
 */
export async function markOutboundPendingAndDispatch(): Promise<void> {
    const config = await resolveGetProviderScheduleConfig()(
        HOSPEDIN_OUTBOUND_PROVIDER_ID
    );
    if (!config?.enabled) {
        return;
    }
    await setOutboundHasPendingTrue();
    await scheduleOutboundDispatch('signal');
}

export async function scheduleOutboundDispatch(
    trigger: OutboundDispatchTrigger = 'signal'
): Promise<void> {
    if (dispatcherTestDeps.suppressSchedule) {
        return;
    }
    if (dispatcherTestDeps.synchronousSchedule) {
        await hospedinOutboundDispatcher.dispatch(trigger);
        return;
    }
    setImmediate(() => {
        void hospedinOutboundDispatcher.dispatch(trigger);
    });
}

/**
 * Dispatcher orientado a pendência — substitui o polling de 1 minuto.
 * A fila real continua em hospedin_outbound_sync_state; has_pending é wake-up.
 */
export class HospedinOutboundDispatcher {
    isDispatchRunning(): boolean {
        return dispatchRunning;
    }

    /**
     * Processa a fila outbound enquanto houver itens claimable.
     * Uma instância/processo por vez (dispatchRunning + providerRunLock).
     */
    async dispatch(trigger: OutboundDispatchTrigger): Promise<void> {
        if (dispatchRunning) {
            pendingTailDispatch = true;
            return;
        }

        dispatchRunning = true;
        try {
            const config = await resolveGetProviderScheduleConfig()(
                HOSPEDIN_OUTBOUND_PROVIDER_ID
            );
            if (!config?.enabled) {
                return;
            }

            await this.drainClaimableQueue(trigger);
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : String(error);
            log.error('outbound:dispatch:failed', { trigger, message });
        } finally {
            dispatchRunning = false;
            if (pendingTailDispatch) {
                pendingTailDispatch = false;
                await scheduleOutboundDispatch('signal');
            }
        }
    }

    private async drainClaimableQueue(
        trigger: OutboundDispatchTrigger
    ): Promise<void> {
        const maxRounds = 500;
        let rounds = 0;

        while (rounds < maxRounds) {
            rounds += 1;

            const state = await IntegrationProviderState.findOne({
                where: { provider: HOSPEDIN_OUTBOUND_PROVIDER_ID },
            });
            if (!state?.hasPending) {
                const claimable = await countClaimableOutbound();
                if (claimable === 0) {
                    return;
                }
                await setOutboundHasPendingTrue();
            }

            if (providerRunLock.isLocked(HOSPEDIN_OUTBOUND_PROVIDER_ID)) {
                log.debug('outbound:dispatch:skip — ciclo já em andamento');
                return;
            }

            const due = await hospedinOutboundStateService.listDue(1);
            if (!due.length) {
                const cleared = await tryClearOutboundPendingIfIdle();
                if (!cleared) {
                    const stillClaimable = await countClaimableOutbound();
                    if (stillClaimable > 0) {
                        continue;
                    }
                }
                return;
            }

            const syncTrigger =
                trigger === 'watchdog'
                    ? IntegrationSyncTrigger.SCHEDULER
                    : IntegrationSyncTrigger.WEBHOOK;

            const result = await resolveRunProviderCycle()(
                HOSPEDIN_OUTBOUND_PROVIDER_ID,
                syncTrigger
            );

            if (result.skipped) {
                log.debug('outbound:dispatch:cycle_skipped', {
                    reason: result.reason,
                    trigger,
                });
                return;
            }

            log.info('outbound:dispatch:cycle_done', {
                trigger,
                correlationId: result.correlationId,
                ok: result.summary?.ok,
                created: result.summary?.created,
                updated: result.summary?.updated,
                cancelled: result.summary?.cancelled,
                failed: result.summary?.failed,
            });
        }

        log.warn('outbound:dispatch:max_rounds', { maxRounds });
    }

    /**
     * Watchdog de segurança (baixa frequência via interval_minutes do provider).
     * Corrige has_pending=0 com itens claimable na fila.
     */
    async runWatchdogIfDue(): Promise<void> {
        const config = await resolveGetProviderScheduleConfig()(
            HOSPEDIN_OUTBOUND_PROVIDER_ID
        );
        if (!config?.enabled) {
            return;
        }

        const state = await IntegrationProviderState.findOne({
            where: { provider: HOSPEDIN_OUTBOUND_PROVIDER_ID },
        });
        if (!state) {
            return;
        }

        if (state.status === IntegrationProviderRuntimeStatus.RUNNING) {
            return;
        }

        const now = Date.now();
        const next = state.nextRunAt
            ? new Date(state.nextRunAt).getTime()
            : 0;
        if (state.nextRunAt && next > now) {
            return;
        }

        const watchdogAt = new Date(
            now + config.intervalMinutes * 60_000
        );
        await state.update({ nextRunAt: watchdogAt });

        const claimable = await countClaimableOutbound();
        if (claimable === 0) {
            return;
        }

        if (!state.hasPending) {
            log.warn('outbound:watchdog — fila claimable com has_pending=0', {
                claimable,
            });
            await setOutboundHasPendingTrue();
        }

        if (
            !dispatchRunning &&
            !providerRunLock.isLocked(HOSPEDIN_OUTBOUND_PROVIDER_ID)
        ) {
            void scheduleOutboundDispatch('watchdog');
        }
    }
}

export const hospedinOutboundDispatcher = new HospedinOutboundDispatcher();

/** Exposto para testes. */
export function _resetOutboundDispatcherForTests(): void {
    dispatchRunning = false;
    pendingTailDispatch = false;
    dispatcherTestDeps = {};
}
