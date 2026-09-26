import { QueryTypes } from 'sequelize';
import connection from '../../../database';
import {
    IntegrationEntityType,
    IntegrationProvider,
    IntegrationSyncStatus,
} from '../../../models/IntegrationSyncState';
import { getCheckinSqlExclusiveThreshold } from '../utils/operationalSyncWindow';

const PENDING_SYNC_STATUSES = [
    IntegrationSyncStatus.READY,
    IntegrationSyncStatus.QUEUED,
    IntegrationSyncStatus.FAILED,
] as const;

/**
 * SQL EXISTS — sem LIMIT 200 / sem N+1.
 * external_id (string) ↔ reservation_id (bigint).
 */
export const PENDING_FUTURE_INBOUND_SYNC_SQL = `
SELECT 1 AS hit
FROM integration_sync_state sis
INNER JOIN hospedin_reservations hr
  ON hr.reservation_id = CAST(sis.external_id AS UNSIGNED)
WHERE sis.provider = :provider
  AND sis.entity_type = :entityType
  AND sis.sync_status IN (:syncStatuses)
  AND hr.checkin > :threshold
LIMIT 1
`;

/**
 * Há reservas futuras com sync pendente (READY/QUEUED/FAILED)?
 * Usado somente após import para omitir execution — não bloqueia API.
 */
export async function hasPendingFutureInboundSync(
    now: Date = new Date()
): Promise<boolean> {
    const threshold = getCheckinSqlExclusiveThreshold(now);

    const rows = (await connection.query(PENDING_FUTURE_INBOUND_SYNC_SQL, {
        replacements: {
            provider: IntegrationProvider.HOSPEDIN,
            entityType: IntegrationEntityType.RESERVATION,
            syncStatuses: [...PENDING_SYNC_STATUSES],
            threshold,
        },
        type: QueryTypes.SELECT,
    })) as Array<{ hit: number }>;

    return rows.length > 0;
}
