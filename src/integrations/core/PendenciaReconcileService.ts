import { Op } from 'sequelize';
import {
    IntegrationEntityType,
    IntegrationSyncState,
    IntegrationSyncStatus,
} from '../../models/IntegrationSyncState';
import {
    isPermanentNonActionableError,
    normalizeSyncErrorCode,
    SyncResolutionStatus,
} from './syncErrorClassification';
import { recordEntitySyncEvent } from './EntitySyncEventService';

export type ReconcilePendenciasResult = {
    scanned: number;
    ignored: number;
    resolved: number;
    keptOpen: number;
};

/**
 * Reavalia pendências OPEN e fecha as que não exigem mais ação.
 * Não apaga histórico (integration_entity_sync_event).
 */
export async function reconcileOpenPendencias(options?: {
    provider?: string;
    limit?: number;
}): Promise<ReconcilePendenciasResult> {
    const where: Record<string, unknown> = {
        entity_type: IntegrationEntityType.RESERVATION,
        resolution_status: SyncResolutionStatus.OPEN,
    };
    if (options?.provider) {
        where.provider = options.provider.toUpperCase();
    }

    const rows = await IntegrationSyncState.findAll({
        where,
        order: [['updated_at', 'ASC']],
        limit: Math.min(5000, Math.max(1, options?.limit ?? 5000)),
    });

    let ignored = 0;
    let resolved = 0;
    let keptOpen = 0;

    for (const row of rows) {
        const syncStatus = String(row.sync_status || '').toUpperCase();
        const code = normalizeSyncErrorCode(
            (row as any).error_code,
            row.last_error
        );
        const permanent = isPermanentNonActionableError(
            code,
            row.last_error
        );

        if (syncStatus === IntegrationSyncStatus.SYNCED) {
            await row.update({
                resolution_status: SyncResolutionStatus.RESOLVED,
                updated_at: new Date(),
            } as any);
            resolved += 1;
            continue;
        }

        if (
            syncStatus === IntegrationSyncStatus.IGNORED ||
            permanent
        ) {
            await row.update({
                sync_status: IntegrationSyncStatus.IGNORED,
                resolution_status: SyncResolutionStatus.IGNORED,
                error_code: code,
                error_severityity: 'INFO',
                next_retry_at: null,
                updated_at: new Date(),
            } as any);
            await recordEntitySyncEvent({
                provider: String(row.provider),
                externalId: row.external_id,
                internalEntityId: row.internal_entity_id,
                operation: 'RECONCILE',
                result: 'IGNORED',
                errorCode: code,
                errorSeverity: 'INFO',
                message:
                    row.last_error ||
                    'Reconciliado: sem ação operacional pendente.',
            });
            ignored += 1;
            continue;
        }

        // Ainda exige ação (mapping, conflict, timeout, etc.)
        if (
            syncStatus === IntegrationSyncStatus.FAILED ||
            syncStatus === IntegrationSyncStatus.WAIT_MAPPING
        ) {
            keptOpen += 1;
            continue;
        }

        // READY/NEW/etc. sem erro permanente: mantém OPEN se ainda não sincronizou
        // mas não é "pendência de erro" — se quiser, podemos fechar READY sem erro.
        // Mantém aberto apenas falhas/wait; demais OPEN sem falha → RESOLVED informativo? 
        // User wants Pendências = work to do. READY is pending sync, not error pendency.
        // For reconcile of "pendências" screen (errors only), close non-error OPEN as RESOLVED
        // only if SYNCED; keep READY as-is but they won't show on Pendências filter.
        keptOpen += 1;
    }

    return {
        scanned: rows.length,
        ignored,
        resolved,
        keptOpen,
    };
}

/**
 * Contagem rápida só de pendências operacionais abertas (erros que pedem ação).
 */
export function openErrorWhere(provider?: string): Record<string, unknown> {
    const where: Record<string, unknown> = {
        entity_type: IntegrationEntityType.RESERVATION,
        resolution_status: SyncResolutionStatus.OPEN,
        sync_status: {
            [Op.in]: [
                IntegrationSyncStatus.FAILED,
                IntegrationSyncStatus.WAIT_MAPPING,
            ],
        },
    };
    if (provider) where.provider = provider.toUpperCase();
    return where;
}
