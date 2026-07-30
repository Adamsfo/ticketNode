import { Op } from 'sequelize';
import { logger } from '../../utils/logger';
import {
    IntegrationEntityType,
    IntegrationSyncState,
    IntegrationSyncStatus,
} from '../../models/IntegrationSyncState';
import { runEntitySync } from './EntityRunService';
import { isTransientErrorCode } from './syncErrorClassification';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

const log = logger.child('SmartRetry');

/**
 * Retry inteligente: a cada 15s processa entidades com next_retry_at vencido
 * e erro temporário (rede/timeout/indisponibilidade), sem esperar o ciclo do scheduler.
 */
export function startEntitySmartRetryJob(): void {
    if (timer) return;
    timer = setInterval(() => {
        void tickSmartRetries();
    }, 15_000);
    log.info('Smart retry iniciado (tick 15s)');
}

export function stopEntitySmartRetryJob(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

async function tickSmartRetries(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const now = new Date();
        const due = await IntegrationSyncState.findAll({
            where: {
                entity_type: IntegrationEntityType.RESERVATION,
                resolution_status: 'OPEN',
                sync_status: {
                    [Op.in]: [
                        IntegrationSyncStatus.FAILED,
                        IntegrationSyncStatus.READY,
                    ],
                },
                next_retry_at: { [Op.lte]: now },
            },
            order: [['next_retry_at', 'ASC']],
            limit: 10,
        });

        for (const state of due) {
            const code = String((state as any).error_code || '');
            if (code && !isTransientErrorCode(code)) {
                await state.update({ next_retry_at: null } as any);
                continue;
            }
            if (!code && state.sync_status === IntegrationSyncStatus.FAILED) {
                const msg = String(state.last_error || '').toLowerCase();
                if (
                    !msg.includes('timeout') &&
                    !msg.includes('network') &&
                    !msg.includes('econn') &&
                    !msg.includes('503') &&
                    !msg.includes('unavailable')
                ) {
                    await state.update({ next_retry_at: null } as any);
                    continue;
                }
            }

            log.debug(
                `retry ${state.provider} #${state.external_id}`
            );
            await runEntitySync({
                provider: String(state.provider),
                externalId: state.external_id,
                trigger: 'SMART_RETRY',
            });
        }
    } catch (error: any) {
        log.error('tick failed', {
            message: error?.message,
            stack: error?.stack,
        });
    } finally {
        running = false;
    }
}
