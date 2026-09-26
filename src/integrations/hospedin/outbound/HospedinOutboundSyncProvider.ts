import { IntegrationSyncTrigger } from '../../../models/IntegrationSyncExecution';
import type {
    IntegrationSyncProvider,
    ProviderScheduleConfig,
    ShouldStartCycleResult,
    SyncRunContext,
    SyncRunSummary,
} from '../../core/types';
import { providerEnvHelpers } from '../../core/ProviderConfigService';
import { logger } from '../../../utils/logger';
import { hospedinOutboundRunner } from './HospedinOutboundRunner';

const { envFlag, envInt } = providerEnvHelpers;
const log = logger.child('HospedinOutbound');

/**
 * Provider outbound Jango → Hospedin (fila assíncrona).
 * Disparo orientado a pendência (has_pending + dispatcher); interval_minutes = watchdog.
 */
export class HospedinOutboundSyncProvider implements IntegrationSyncProvider {
    readonly id = 'HOSPEDIN_OUTBOUND';
    readonly displayName = 'Hospedin Outbound';

    getEnvDefaults(): Partial<ProviderScheduleConfig> & {
        enabled: boolean;
        intervalMinutes: number;
    } {
        return {
            enabled: envFlag(
                process.env.HOSPEDIN_OUTBOUND_SYNC_ENABLED,
                false
            ),
            intervalMinutes: envInt(
                process.env.HOSPEDIN_OUTBOUND_SYNC_INTERVAL_MINUTES,
                15,
                1
            ),
            mode: 'incremental',
            syncLimit: envInt(
                process.env.HOSPEDIN_OUTBOUND_SYNC_LIMIT,
                30,
                1
            ),
            priority: envInt(
                process.env.HOSPEDIN_OUTBOUND_SYNC_PRIORITY,
                110,
                1
            ),
            maxRetries: envInt(
                process.env.HOSPEDIN_OUTBOUND_SYNC_MAX_RETRIES,
                5,
                0
            ),
            backoffBaseSeconds: envInt(
                process.env.HOSPEDIN_OUTBOUND_SYNC_BACKOFF_BASE_SECONDS,
                30,
                1
            ),
            webhookEnabled: false,
            displayName: 'Hospedin Outbound',
        };
    }

    async shouldStartCycle(
        ctx: SyncRunContext,
        _config: ProviderScheduleConfig
    ): Promise<ShouldStartCycleResult> {
        const trigger = String(ctx.trigger || '').toUpperCase();
        if (
            trigger === IntegrationSyncTrigger.MANUAL ||
            trigger === IntegrationSyncTrigger.API ||
            trigger === IntegrationSyncTrigger.WEBHOOK
        ) {
            return { start: true };
        }
        const { hospedinOutboundStateService } = await import(
            './HospedinOutboundStateService'
        );
        const eligible = await hospedinOutboundStateService.countEligibleDue(1);
        if (eligible === 0) {
            return {
                start: false,
                reason: 'Fila outbound sem itens elegíveis (due + janela temporal).',
            };
        }
        return { start: true };
    }

    async runCycle(ctx: SyncRunContext): Promise<SyncRunSummary> {
        const syncLimit = ctx.syncLimit ?? 30;

        log.info('outbound:runCycle:start', {
            trigger: ctx.trigger,
            correlationId: ctx.correlationId,
            syncLimit,
        });

        const summary = await hospedinOutboundRunner.runCycle(ctx);

        log.info('outbound:runCycle:end', {
            correlationId: ctx.correlationId,
            ok: summary.ok,
            created: summary.created,
            updated: summary.updated,
            failed: summary.failed,
            skipped: summary.skipped,
        });

        return summary;
    }
}

export const hospedinOutboundSyncProvider = new HospedinOutboundSyncProvider();
