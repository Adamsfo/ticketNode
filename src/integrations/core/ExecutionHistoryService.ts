import { fn, col, literal, Op } from 'sequelize';
import {
    IntegrationSyncExecution,
    IntegrationSyncExecutionStatus,
    IntegrationSyncTrigger,
    type IntegrationSyncExecutionStatusValue,
    type IntegrationSyncTriggerValue,
} from '../../models/IntegrationSyncExecution';
import type { SyncRunSummary } from './types';

export async function createRunningExecution(input: {
    provider: string;
    trigger: IntegrationSyncTriggerValue | string;
    mode?: string | null;
    correlationId: string;
}): Promise<IntegrationSyncExecution> {
    return IntegrationSyncExecution.create({
        provider: input.provider.toUpperCase(),
        triggerSource: input.trigger || IntegrationSyncTrigger.SCHEDULER,
        mode: input.mode ?? null,
        correlationId: input.correlationId,
        startedAt: new Date(),
        status: IntegrationSyncExecutionStatus.RUNNING,
    });
}

export async function createSkippedExecution(input: {
    provider: string;
    trigger: IntegrationSyncTriggerValue | string;
    correlationId: string;
    reason: string;
}): Promise<IntegrationSyncExecution> {
    const now = new Date();
    return IntegrationSyncExecution.create({
        provider: input.provider.toUpperCase(),
        triggerSource: input.trigger || IntegrationSyncTrigger.SCHEDULER,
        correlationId: input.correlationId,
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        status: IntegrationSyncExecutionStatus.SKIPPED,
        errorMessage: input.reason,
        skippedCount: 1,
    });
}

export async function finishExecution(
    execution: IntegrationSyncExecution,
    summary: SyncRunSummary,
    status: IntegrationSyncExecutionStatusValue
): Promise<IntegrationSyncExecution> {
    const finishedAt = new Date();
    const durationMs = Math.max(
        0,
        finishedAt.getTime() - new Date(execution.startedAt).getTime()
    );

    await execution.update({
        finishedAt,
        durationMs,
        status,
        imported: summary.imported ?? null,
        validated: summary.validated ?? null,
        validatedReady: summary.validatedReady ?? null,
        validatedIgnored: summary.validatedIgnored ?? null,
        createdCount: summary.created ?? null,
        updatedCount: summary.updated ?? null,
        cancelledCount: summary.cancelled ?? null,
        failedCount: summary.failed ?? null,
        skippedCount: summary.skipped ?? null,
        unchangedCount: summary.unchanged ?? null,
        errorMessage: summary.errorMessage ?? null,
        summaryJson: summary.details ?? null,
    });

    return execution;
}

export type ListExecutionsFilters = {
    provider?: string;
    trigger?: string;
    status?: string;
    limit?: number;
    offset?: number;
};

export function mapExecutionRow(r: IntegrationSyncExecution) {
    return {
        id: r.id,
        provider: r.provider,
        triggerSource: r.triggerSource,
        mode: r.mode ?? null,
        correlationId: r.correlationId,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt ?? null,
        durationMs: r.durationMs ?? null,
        status: r.status,
        imported: r.imported ?? null,
        validated: r.validated ?? null,
        validatedReady: r.validatedReady ?? null,
        validatedIgnored: r.validatedIgnored ?? null,
        created: r.createdCount ?? null,
        updated: r.updatedCount ?? null,
        cancelled: r.cancelledCount ?? null,
        failed: r.failedCount ?? null,
        skipped: r.skippedCount ?? null,
        unchanged: r.unchangedCount ?? null,
        errorMessage: r.errorMessage ?? null,
        summaryJson: r.summaryJson ?? null,
    };
}

export async function listRecentExecutions(
    providerIdOrFilters?: string | ListExecutionsFilters,
    limitLegacy = 20
): Promise<IntegrationSyncExecution[]> {
    const filters: ListExecutionsFilters =
        typeof providerIdOrFilters === 'string' ||
        providerIdOrFilters === undefined
            ? { provider: providerIdOrFilters, limit: limitLegacy }
            : providerIdOrFilters;

    const where: Record<string, unknown> = {};
    if (filters.provider) {
        where.provider = String(filters.provider).toUpperCase();
    }
    if (filters.trigger) {
        where.triggerSource = String(filters.trigger).toUpperCase();
    }
    if (filters.status) {
        where.status = String(filters.status).toUpperCase();
    }

    return IntegrationSyncExecution.findAll({
        where,
        order: [['startedAt', 'DESC']],
        limit: Math.min(100, Math.max(1, filters.limit ?? 50)),
        offset: Math.max(0, filters.offset ?? 0),
    });
}

export async function getExecutionById(
    id: number
): Promise<IntegrationSyncExecution | null> {
    if (!Number.isFinite(id) || id <= 0) return null;
    return IntegrationSyncExecution.findByPk(id);
}

export type ProviderExecutionStats = {
    total: number;
    success: number;
    failed: number;
    partial: number;
    skipped: number;
    running: number;
    successRate: number;
    last7Days: number;
    last30Days: number;
    avgDurationMs: number | null;
    maxDurationMs: number | null;
    minDurationMs: number | null;
    avgSyncedPerRun: number | null;
};

/**
 * Agregações SQL sobre integration_sync_execution (sem carregar todas as linhas).
 */
export async function getProviderExecutionStats(
    provider: string
): Promise<ProviderExecutionStats> {
    const providerKey = String(provider).toUpperCase();
    const now = Date.now();
    const d7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const d30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const statusRows = (await IntegrationSyncExecution.findAll({
        attributes: ['status', [fn('COUNT', col('id')), 'total']],
        where: { provider: providerKey },
        group: ['status'],
        raw: true,
    })) as unknown as Array<{ status: string; total: string | number }>;

    const counts: Record<string, number> = {};
    for (const row of statusRows) {
        counts[String(row.status || '').toUpperCase()] = Number(row.total || 0);
    }

    const success = counts[IntegrationSyncExecutionStatus.SUCCESS] || 0;
    const failed = counts[IntegrationSyncExecutionStatus.FAILED] || 0;
    const partial = counts[IntegrationSyncExecutionStatus.PARTIAL] || 0;
    const skipped = counts[IntegrationSyncExecutionStatus.SKIPPED] || 0;
    const running = counts[IntegrationSyncExecutionStatus.RUNNING] || 0;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const successRate =
        total > 0 ? Math.round((success / total) * 10000) / 100 : 0;

    const last7Days = await IntegrationSyncExecution.count({
        where: {
            provider: providerKey,
            startedAt: { [Op.gte]: d7 },
        },
    });
    const last30Days = await IntegrationSyncExecution.count({
        where: {
            provider: providerKey,
            startedAt: { [Op.gte]: d30 },
        },
    });

    const durationRow = (await IntegrationSyncExecution.findOne({
        attributes: [
            [fn('AVG', col('duration_ms')), 'avgDurationMs'],
            [fn('MAX', col('duration_ms')), 'maxDurationMs'],
            [fn('MIN', col('duration_ms')), 'minDurationMs'],
        ],
        where: {
            provider: providerKey,
            durationMs: { [Op.ne]: null },
            status: {
                [Op.notIn]: [
                    IntegrationSyncExecutionStatus.RUNNING,
                    IntegrationSyncExecutionStatus.SKIPPED,
                ],
            },
        },
        raw: true,
    })) as unknown as {
        avgDurationMs?: string | number | null;
        maxDurationMs?: string | number | null;
        minDurationMs?: string | number | null;
    } | null;

    const syncedRow = (await IntegrationSyncExecution.findOne({
        attributes: [
            [
                fn(
                    'AVG',
                    literal(
                        'COALESCE(created_count,0) + COALESCE(updated_count,0) + COALESCE(cancelled_count,0)'
                    )
                ),
                'avgSynced',
            ],
        ],
        where: {
            provider: providerKey,
            status: {
                [Op.in]: [
                    IntegrationSyncExecutionStatus.SUCCESS,
                    IntegrationSyncExecutionStatus.PARTIAL,
                    IntegrationSyncExecutionStatus.FAILED,
                ],
            },
        },
        raw: true,
    })) as unknown as { avgSynced?: string | number | null } | null;

    return {
        total,
        success,
        failed: failed + partial,
        partial,
        skipped,
        running,
        successRate,
        last7Days,
        last30Days,
        avgDurationMs:
            durationRow?.avgDurationMs != null
                ? Math.round(Number(durationRow.avgDurationMs))
                : null,
        maxDurationMs:
            durationRow?.maxDurationMs != null
                ? Number(durationRow.maxDurationMs)
                : null,
        minDurationMs:
            durationRow?.minDurationMs != null
                ? Number(durationRow.minDurationMs)
                : null,
        avgSyncedPerRun:
            syncedRow?.avgSynced != null
                ? Math.round(Number(syncedRow.avgSynced) * 100) / 100
                : null,
    };
}

export function resolveExecutionStatus(
    summary: SyncRunSummary
): IntegrationSyncExecutionStatusValue {
    if (!summary.ok) return IntegrationSyncExecutionStatus.FAILED;
    const failed = Number(summary.failed || 0);
    if (failed > 0) return IntegrationSyncExecutionStatus.PARTIAL;
    return IntegrationSyncExecutionStatus.SUCCESS;
}

export type ExecutionVolumeStats = {
    execucoes: number;
    importadas: number;
    validadas: number;
    created: number;
    updated: number;
    cancelled: number;
    failed: number;
    ignored: number;
    unchanged: number;
    reservasSincronizadas: number;
};

/** SUM/COUNT sobre integration_sync_execution (opcionalmente por provider). */
export async function getExecutionVolumeStats(
    provider?: string
): Promise<ExecutionVolumeStats> {
    const where: Record<string, unknown> = {};
    if (provider) where.provider = String(provider).toUpperCase();

    const row = (await IntegrationSyncExecution.findOne({
        attributes: [
            [fn('COUNT', col('id')), 'execucoes'],
            [fn('SUM', col('imported')), 'importadas'],
            [fn('SUM', col('validated')), 'validadas'],
            [fn('SUM', col('created_count')), 'created'],
            [fn('SUM', col('updated_count')), 'updated'],
            [fn('SUM', col('cancelled_count')), 'cancelled'],
            [fn('SUM', col('failed_count')), 'failed'],
            [
                fn(
                    'SUM',
                    literal(
                        'COALESCE(validated_ignored,0) + COALESCE(skipped_count,0)'
                    )
                ),
                'ignored',
            ],
            [fn('SUM', col('unchanged_count')), 'unchanged'],
            [
                fn(
                    'SUM',
                    literal(
                        'COALESCE(created_count,0) + COALESCE(updated_count,0) + COALESCE(cancelled_count,0)'
                    )
                ),
                'reservasSincronizadas',
            ],
        ],
        where,
        raw: true,
    })) as unknown as Record<string, string | number | null> | null;

    const n = (k: string) => Number(row?.[k] || 0);
    return {
        execucoes: n('execucoes'),
        importadas: n('importadas'),
        validadas: n('validadas'),
        created: n('created'),
        updated: n('updated'),
        cancelled: n('cancelled'),
        failed: n('failed'),
        ignored: n('ignored'),
        unchanged: n('unchanged'),
        reservasSincronizadas: n('reservasSincronizadas'),
    };
}

/** Última execução finalizada (não RUNNING), mais recente. */
export async function getLatestFinishedExecution(
    provider?: string
): Promise<IntegrationSyncExecution | null> {
    const where: Record<string, unknown> = {
        status: {
            [Op.ne]: IntegrationSyncExecutionStatus.RUNNING,
        },
    };
    if (provider) where.provider = String(provider).toUpperCase();

    return IntegrationSyncExecution.findOne({
        where,
        order: [['startedAt', 'DESC']],
    });
}
