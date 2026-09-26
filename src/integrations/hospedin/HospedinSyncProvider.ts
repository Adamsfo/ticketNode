import type {
    IntegrationSyncProvider,
    ProviderScheduleConfig,
    ShouldStartCycleResult,
    SyncRunContext,
    SyncRunSummary,
} from '../core/types';
import { providerEnvHelpers } from '../core/ProviderConfigService';
import { importHospedinReservations } from './services/HospedinImportReservationService';
import { shouldOmitInboundExecutionAfterPreflight } from './services/hospedinInboundPostImportPolicy';
import { hasPendingFutureInboundSync } from './services/hospedinInboundWorkProbe';
import { hospedinReservationValidationService } from './services/HospedinReservationValidationService';
import { reservationSyncRunner } from './sync/ReservationSyncRunner';
import { HospedinLogger } from './logger/HospedinLogger';

const { envFlag, envInt } = providerEnvHelpers;

/**
 * Adapter Hospedin: runCycle = pipeline oficial Import → Validate → Sync.
 * Scheduler e webhook reutilizam este mesmo método.
 */
export class HospedinSyncProvider implements IntegrationSyncProvider {
    readonly id = 'HOSPEDIN';
    readonly displayName = 'Hospedin';

    getEnvDefaults(): Partial<ProviderScheduleConfig> & {
        enabled: boolean;
        intervalMinutes: number;
    } {
        return {
            enabled: envFlag(process.env.HOSPEDIN_SYNC_ENABLED, false),
            intervalMinutes: envInt(
                process.env.HOSPEDIN_SYNC_INTERVAL_MINUTES,
                5,
                1
            ),
            mode: (process.env.HOSPEDIN_SYNC_MODE || 'incremental').trim(),
            syncLimit: envInt(process.env.HOSPEDIN_SYNC_LIMIT, 50, 1),
            priority: envInt(process.env.HOSPEDIN_SYNC_PRIORITY, 100, 1),
            maxRetries: envInt(process.env.HOSPEDIN_SYNC_MAX_RETRIES, 2, 0),
            backoffBaseSeconds: envInt(
                process.env.HOSPEDIN_SYNC_BACKOFF_BASE_SECONDS,
                30,
                1
            ),
            webhookEnabled: envFlag(
                process.env.HOSPEDIN_SYNC_WEBHOOK_ENABLED,
                false
            ),
            displayName: 'Hospedin',
        };
    }

    /**
     * Sempre consulta a API (arquivo completo). Filtro check-in futuro em memória no import.
     * Omit execution só quando, após o download, não há futuras no arquivo nem sync pendente.
     */
    async preflightCycle(
        ctx: SyncRunContext,
        _config: ProviderScheduleConfig
    ): Promise<ShouldStartCycleResult> {
        const mode = ctx.mode || 'incremental';
        const importResult = await importHospedinReservations({
            fetchDetails: false,
            mode,
        });
        ctx.hospedinPreflightImport = importResult;

        if (importResult.sucesso === false) {
            return { start: true };
        }

        const pending = await hasPendingFutureInboundSync();
        const importWorkFound = Boolean(importResult.importWorkFound);
        const omit = shouldOmitInboundExecutionAfterPreflight({
            trigger: String(ctx.trigger || ''),
            mode,
            importWorkFound,
            hasPendingFutureSync: pending,
        });

        if (omit) {
            HospedinLogger.info('pipeline:preflight:omit_execution', {
                correlationId: ctx.correlationId,
                trigger: ctx.trigger,
                fetched: importResult.fetched,
                discarded: importResult.discarded,
                remaining: importResult.remaining,
                importCreated: importResult.importCreated,
                importUpdated: importResult.importUpdated,
                importUnchanged: importResult.importUnchanged,
                importWorkFound,
                pendingFutureSync: pending,
            });
            return {
                start: false,
                reason:
                    'Após import: sem reserva nova/alterada e sem sync pendente futuro — execution omitida.',
            };
        }

        return { start: true };
    }

    async runCycle(ctx: SyncRunContext): Promise<SyncRunSummary> {
        const mode = ctx.mode || 'incremental';
        const syncLimit = ctx.syncLimit ?? 50;

        HospedinLogger.info('pipeline:runCycle:start', {
            trigger: ctx.trigger,
            correlationId: ctx.correlationId,
            mode,
            syncLimit,
        });

        // 1) Import (ou reutiliza preflight)
        const importResult =
            ctx.hospedinPreflightImport &&
            ctx.hospedinPreflightImport.sucesso !== false
                ? {
                      operacao: 'import_reservations',
                      fetched: ctx.hospedinPreflightImport.fetched ?? 0,
                      upserted: ctx.hospedinPreflightImport.upserted ?? 0,
                      remaining: ctx.hospedinPreflightImport.remaining ?? 0,
                      discarded: ctx.hospedinPreflightImport.discarded ?? 0,
                      importCreated:
                          ctx.hospedinPreflightImport.importCreated ?? 0,
                      importUpdated:
                          ctx.hospedinPreflightImport.importUpdated ?? 0,
                      importUnchanged:
                          ctx.hospedinPreflightImport.importUnchanged ?? 0,
                      importWorkFound:
                          ctx.hospedinPreflightImport.importWorkFound ?? false,
                      mode: ctx.hospedinPreflightImport.mode ?? mode,
                      sucesso: true as const,
                      durationMs: 0,
                      accountId: null,
                  }
                : await importHospedinReservations({
                      fetchDetails: false,
                      mode,
                  });
        HospedinLogger.info('pipeline:runCycle:import', {
            correlationId: ctx.correlationId,
            fetched: importResult.fetched,
            upserted: importResult.upserted,
            discarded: importResult.discarded,
        });

        // 2) Validate
        const validateResult =
            await hospedinReservationValidationService.validateAll({ mode });
        const validatedIgnored = Math.max(
            0,
            Number(validateResult.total || 0) -
                Number(validateResult.ready || 0)
        );
        HospedinLogger.info('pipeline:runCycle:validate', {
            correlationId: ctx.correlationId,
            total: validateResult.total,
            ready: validateResult.ready,
            discarded: validateResult.discarded,
            ignored: validatedIgnored,
        });

        // 3) Sync
        const syncResult = await reservationSyncRunner.processReady({
            limit: syncLimit,
            mode,
        });

        let created = 0;
        let updated = 0;
        let cancelled = 0;
        let failed = 0;
        let skipped = 0;
        let unchanged = 0;

        for (const r of syncResult.results) {
            const action = String(r.action || '').toUpperCase();
            if (!r.ok || action === 'ERROR') {
                failed += 1;
                continue;
            }
            if (action === 'CREATE') created += 1;
            else if (action === 'UPDATE') updated += 1;
            else if (action === 'CANCEL') cancelled += 1;
            else if (
                action === 'IGNORE' ||
                action === 'SKIPPED' ||
                r.code === 'SKIPPED' ||
                r.code === 'ORIGIN_CONFLICT'
            ) {
                skipped += 1;
            } else if (
                action === 'UNCHANGED' ||
                r.code === 'ALREADY_SYNCED' ||
                r.code === 'UNCHANGED'
            ) {
                unchanged += 1;
            } else {
                unchanged += 1;
            }
        }

        HospedinLogger.info('pipeline:runCycle:sync', {
            correlationId: ctx.correlationId,
            total: syncResult.total,
            created,
            updated,
            cancelled,
            failed,
            skipped,
            unchanged,
        });

        const ok = failed === 0 && Boolean(importResult.sucesso !== false);

        return {
            ok,
            imported: importResult.upserted ?? importResult.remaining ?? 0,
            validated: validateResult.total,
            validatedReady: validateResult.ready,
            validatedIgnored,
            created,
            updated,
            cancelled,
            failed,
            skipped,
            unchanged,
            errorMessage:
                failed > 0
                    ? `${failed} reserva(s) falharam no Sync.`
                    : importResult.sucesso === false
                      ? 'Falha no Import Hospedin.'
                      : null,
            details: {
                trigger: ctx.trigger,
                mode,
                import: {
                    fetched: importResult.fetched,
                    discarded: importResult.discarded,
                    remaining: importResult.remaining,
                    upserted: importResult.upserted,
                    durationMs: importResult.durationMs,
                },
                validate: {
                    total: validateResult.total,
                    ready: validateResult.ready,
                    discarded: validateResult.discarded,
                },
                sync: {
                    total: syncResult.total,
                    discarded: syncResult.discarded,
                    created,
                    updated,
                    cancelled,
                    failed,
                    skipped,
                    unchanged,
                },
            },
        };
    }
}

export const hospedinSyncProvider = new HospedinSyncProvider();
