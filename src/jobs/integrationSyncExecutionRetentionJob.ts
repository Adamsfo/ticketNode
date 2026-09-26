import { Op } from 'sequelize';
import { logger } from '../utils/logger';
import { IntegrationSyncExecution } from '../models/IntegrationSyncExecution';

const log = logger.child('IntegrationSyncExecutionRetention');

const DEFAULT_RETENTION_DAYS = 90;
const TICK_MS = 24 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

export function resolveIntegrationSyncExecutionRetentionDays(): number {
    const raw = process.env.INTEGRATION_SYNC_EXECUTION_RETENTION_DAYS;
    if (raw == null || raw === '') {
        return DEFAULT_RETENTION_DAYS;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 7) {
        return DEFAULT_RETENTION_DAYS;
    }
    return Math.floor(n);
}

/**
 * Remove execuções antigas (não roda TRUNCATE).
 * Período padrão 90d: cobre last30Days em getProviderExecutionStats + margem para UI.
 */
export async function pruneIntegrationSyncExecutions(
    retentionDays = resolveIntegrationSyncExecutionRetentionDays()
): Promise<{ deleted: number; retentionDays: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const deleted = await IntegrationSyncExecution.destroy({
        where: {
            startedAt: { [Op.lt]: cutoff },
        },
    });
    if (deleted > 0) {
        log.info('prune completed', { deleted, retentionDays, cutoff });
    }
    return { deleted, retentionDays };
}

export function startIntegrationSyncExecutionRetentionJob(): void {
    if (timer) return;
    const retentionDays = resolveIntegrationSyncExecutionRetentionDays();
    log.info('retention job started', {
        retentionDays,
        intervalHours: TICK_MS / 3600000,
    });
    timer = setInterval(() => {
        void pruneIntegrationSyncExecutions().catch((error: unknown) => {
            const message =
                error instanceof Error ? error.message : String(error);
            log.error('prune failed', { message });
        });
    }, TICK_MS);
    setTimeout(() => {
        void pruneIntegrationSyncExecutions().catch(() => undefined);
    }, 60_000);
}

export function stopIntegrationSyncExecutionRetentionJob(): void {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
