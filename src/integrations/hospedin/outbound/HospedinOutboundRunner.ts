import { logger } from '../../../utils/logger';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundStatus,
} from '../../../models/HospedinOutboundSyncState';
import type { SyncRunContext, SyncRunSummary } from '../../core/types';
import { providerEnvHelpers } from '../../core/ProviderConfigService';
import { hospedinOutboundCancelService } from './HospedinOutboundCancelService';
import { hospedinOutboundCreateService } from './HospedinOutboundCreateService';
import { hospedinOutboundUpdateService } from './HospedinOutboundUpdateService';
import { hospedinOutboundStateService } from './HospedinOutboundStateService';

const { envInt } = providerEnvHelpers;
const log = logger.child('HospedinOutboundRunner');

export type OutboundRunItemResult = {
    id: number;
    idReservaHospedagem: number;
    action: string;
    claimed: boolean;
    outcome: string;
};

/**
 * Runner da fila outbound Jango → Hospedin.
 * CREATE real via HospedinOutboundCreateService; UPDATE via HospedinOutboundUpdateService.
 */
export class HospedinOutboundRunner {
    async runCycle(ctx: SyncRunContext): Promise<SyncRunSummary> {
        const syncLimit = Math.max(1, Number(ctx.syncLimit) || 30);
        const correlationId = ctx.correlationId;
        const maxRetries = envInt(
            process.env.HOSPEDIN_OUTBOUND_SYNC_MAX_RETRIES,
            5,
            0
        );
        const backoffBaseSeconds = envInt(
            process.env.HOSPEDIN_OUTBOUND_SYNC_BACKOFF_BASE_SECONDS,
            30,
            1
        );

        const recovery = await hospedinOutboundStateService.recoverStaleProcessing();
        if (recovery.recovered > 0) {
            log.warn('outbound:recoverStaleProcessing', {
                correlationId,
                recovered: recovery.recovered,
            });
        }

        const candidates = await hospedinOutboundStateService.listDue(syncLimit);

        let created = 0;
        let updated = 0;
        let cancelled = 0;
        let skipped = 0;
        let failed = 0;
        const items: OutboundRunItemResult[] = [];

        for (const candidate of candidates) {
            const claimed = await hospedinOutboundStateService.tryClaim(
                candidate.id,
                correlationId
            );

            if (!claimed) {
                skipped += 1;
                items.push({
                    id: candidate.id,
                    idReservaHospedagem: candidate.id_reserva_hospedagem,
                    action: String(candidate.desired_action || ''),
                    claimed: false,
                    outcome: 'claim_skipped',
                });
                continue;
            }

            const action = String(candidate.desired_action || '').toUpperCase();
            const outboundStatus = String(candidate.outbound_status || '');
            const isCancel =
                action === HospedinOutboundDesiredAction.CANCEL ||
                outboundStatus === HospedinOutboundStatus.PENDING_CANCEL;
            const isCreate =
                !isCancel &&
                (action === HospedinOutboundDesiredAction.CREATE ||
                    outboundStatus === HospedinOutboundStatus.PENDING_CREATE);

            try {
                if (isCancel) {
                    const result = await hospedinOutboundCancelService.cancel(
                        candidate,
                        {
                            correlationId,
                            maxRetries,
                            backoffBaseSeconds,
                        }
                    );

                    if (
                        result.outcome === 'cancelled' ||
                        result.outcome === 'idempotent'
                    ) {
                        cancelled += 1;
                    } else if (result.outcome === 'aborted') {
                        skipped += 1;
                    } else if (result.outcome === 'retry') {
                        failed += 1;
                    } else {
                        failed += 1;
                    }

                    items.push({
                        id: candidate.id,
                        idReservaHospedagem: candidate.id_reserva_hospedagem,
                        action: HospedinOutboundDesiredAction.CANCEL,
                        claimed: true,
                        outcome: result.outcome,
                    });
                } else if (isCreate) {
                    const result = await hospedinOutboundCreateService.create(
                        candidate,
                        {
                            correlationId,
                            maxRetries,
                            backoffBaseSeconds,
                        }
                    );

                    if (
                        result.outcome === 'created' ||
                        result.outcome === 'idempotent'
                    ) {
                        created += 1;
                    } else if (result.outcome === 'deferred') {
                        skipped += 1;
                    } else if (result.outcome === 'retry') {
                        failed += 1;
                    } else {
                        failed += 1;
                    }

                    items.push({
                        id: candidate.id,
                        idReservaHospedagem: candidate.id_reserva_hospedagem,
                        action: HospedinOutboundDesiredAction.CREATE,
                        claimed: true,
                        outcome: result.outcome,
                    });
                } else {
                    const result = await hospedinOutboundUpdateService.update(
                        candidate,
                        {
                            correlationId,
                            maxRetries,
                            backoffBaseSeconds,
                        }
                    );

                    if (
                        result.outcome === 'updated' ||
                        result.outcome === 'idempotent'
                    ) {
                        updated += 1;
                    } else if (
                        result.outcome === 'deferred' ||
                        result.outcome === 'stale'
                    ) {
                        skipped += 1;
                    } else if (result.outcome === 'retry') {
                        failed += 1;
                    } else {
                        failed += 1;
                    }

                    items.push({
                        id: candidate.id,
                        idReservaHospedagem: candidate.id_reserva_hospedagem,
                        action: HospedinOutboundDesiredAction.UPDATE,
                        claimed: true,
                        outcome: result.outcome,
                    });
                }
            } catch (error: unknown) {
                failed += 1;
                const message =
                    error instanceof Error ? error.message : String(error);
                log.error('outbound:create:unexpected', {
                    correlationId,
                    idReservaHospedagem: candidate.id_reserva_hospedagem,
                    message,
                });

                try {
                    const nextRetryCount = Number(candidate.retry_count || 0) + 1;
                    if (nextRetryCount <= maxRetries) {
                        await hospedinOutboundStateService.markWaitRetry(
                            candidate.id,
                            {
                                errorMessage: message,
                                errorCode: 'UNEXPECTED_ERROR',
                                retryCount: nextRetryCount,
                                backoffBaseSeconds,
                            }
                        );
                    } else {
                        await hospedinOutboundStateService.markFailed(
                            candidate.id,
                            {
                                errorMessage: message,
                                errorCode: 'UNEXPECTED_ERROR',
                            }
                        );
                    }
                } catch {
                    /* recovery stale cobre órfãos */
                }

                items.push({
                    id: candidate.id,
                    idReservaHospedagem: candidate.id_reserva_hospedagem,
                    action,
                    claimed: true,
                    outcome: 'error',
                });
            }
        }

        const ok = failed === 0;

        log.info('outbound:runCycle:done', {
            correlationId,
            syncLimit,
            candidates: candidates.length,
            created,
            updated,
            cancelled,
            skipped,
            failed,
            recovered: recovery.recovered,
        });

        return {
            ok,
            created,
            updated,
            cancelled,
            failed,
            skipped,
            errorMessage:
                failed > 0
                    ? `${failed} reserva(s) falharam no outbound.`
                    : null,
            details: {
                trigger: ctx.trigger,
                mode: ctx.mode,
                dryRun: false,
                recovered: recovery.recovered,
                candidates: candidates.length,
                items,
            },
        };
    }
}

export const hospedinOutboundRunner = new HospedinOutboundRunner();
