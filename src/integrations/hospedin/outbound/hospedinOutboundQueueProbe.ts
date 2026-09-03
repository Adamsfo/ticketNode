import { QueryTypes } from 'sequelize';
import connection from '../../../database';
import { OUTBOUND_CLAIMABLE_STATUSES } from './hospedinOutboundClaimable';

export const HOSPEDIN_OUTBOUND_PROVIDER_ID = 'HOSPEDIN_OUTBOUND';

/** Backend em memória — somente testes de integração. */
export interface OutboundQueueProbeTestBackend {
    countClaimableOutbound(): Promise<number>;
    setOutboundHasPendingTrue(): Promise<void>;
    tryClearOutboundPendingIfIdle(): Promise<boolean>;
    getProviderHasPending(): Promise<boolean>;
}

let queueProbeTestBackend: OutboundQueueProbeTestBackend | null = null;

export function _setOutboundQueueProbeTestBackend(
    backend: OutboundQueueProbeTestBackend | null
): void {
    queueProbeTestBackend = backend;
}

const CLAIMABLE_IN = OUTBOUND_CLAIMABLE_STATUSES.map((s) => `'${s}'`).join(
    ', '
);

const CLAIMABLE_EXISTS_SQL = `
    SELECT 1
    FROM hospedin_outbound_sync_state o
    WHERE o.outbound_status IN (${CLAIMABLE_IN})
      AND (o.next_retry_at IS NULL OR o.next_retry_at <= UTC_TIMESTAMP())
    LIMIT 1
`;

/**
 * Conta itens claimable (due) na fila outbound.
 */
export async function countClaimableOutbound(): Promise<number> {
    if (queueProbeTestBackend) {
        return queueProbeTestBackend.countClaimableOutbound();
    }
    const rows = (await connection.query(
        `SELECT COUNT(*) AS cnt
         FROM hospedin_outbound_sync_state o
         WHERE o.outbound_status IN (${CLAIMABLE_IN})
           AND (o.next_retry_at IS NULL OR o.next_retry_at <= UTC_TIMESTAMP())`,
        { type: QueryTypes.SELECT }
    )) as Array<{ cnt: number }>;
    return Number(rows[0]?.cnt ?? 0);
}

/**
 * Sinaliza pendência outbound (wake-up). Idempotente.
 */
export async function setOutboundHasPendingTrue(): Promise<void> {
    if (queueProbeTestBackend) {
        await queueProbeTestBackend.setOutboundHasPendingTrue();
        return;
    }
    await connection.query(
        `UPDATE integration_provider_state
         SET has_pending = 1, updated_at = UTC_TIMESTAMP()
         WHERE provider = :provider`,
        {
            replacements: { provider: HOSPEDIN_OUTBOUND_PROVIDER_ID },
            type: QueryTypes.UPDATE,
        }
    );
}

/**
 * Limpa has_pending somente se não houver itens claimable.
 * Atômico — evita perder sinalização concorrente.
 * @returns true se has_pending foi zerado nesta execução.
 */
export async function tryClearOutboundPendingIfIdle(): Promise<boolean> {
    if (queueProbeTestBackend) {
        return queueProbeTestBackend.tryClearOutboundPendingIfIdle();
    }
    const [, metadata] = await connection.query(
        `UPDATE integration_provider_state ips
         SET ips.has_pending = 0, ips.updated_at = UTC_TIMESTAMP()
         WHERE ips.provider = :provider
           AND ips.has_pending = 1
           AND NOT EXISTS (${CLAIMABLE_EXISTS_SQL})`,
        {
            replacements: { provider: HOSPEDIN_OUTBOUND_PROVIDER_ID },
            type: QueryTypes.UPDATE,
        }
    );
    const affected =
        typeof metadata === 'number'
            ? metadata
            : Number((metadata as { affectedRows?: number })?.affectedRows ?? 0);
    return affected > 0;
}
