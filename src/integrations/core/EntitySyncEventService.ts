import { Op } from 'sequelize';
import { IntegrationEntitySyncEvent } from '../../models/IntegrationEntitySyncEvent';

export async function recordEntitySyncEvent(input: {
    provider: string;
    entityType?: string;
    externalId: string | number;
    internalEntityId?: string | null;
    operation: string;
    result: string;
    errorCode?: string | null;
    errorSeverity?: string | null;
    message?: string | null;
    durationMs?: number | null;
    correlationId?: string | null;
}): Promise<IntegrationEntitySyncEvent> {
    return IntegrationEntitySyncEvent.create({
        provider: String(input.provider).toUpperCase(),
        entityType: input.entityType || 'RESERVATION',
        externalId: String(input.externalId),
        internalEntityId: input.internalEntityId
            ? String(input.internalEntityId)
            : null,
        operation: String(input.operation).toUpperCase(),
        result: String(input.result).toUpperCase(),
        errorCode: input.errorCode ?? null,
        errorSeverity: input.errorSeverity ?? null,
        message: input.message ?? null,
        durationMs: input.durationMs ?? null,
        correlationId: input.correlationId ?? null,
        createdAt: new Date(),
    });
}

export async function listEntitySyncEvents(input: {
    provider?: string;
    externalId?: string;
    internalEntityId?: string;
    limit?: number;
}): Promise<IntegrationEntitySyncEvent[]> {
    const where: Record<string, unknown> = {
        entityType: 'RESERVATION',
    };
    if (input.provider) where.provider = String(input.provider).toUpperCase();
    if (input.externalId) where.externalId = String(input.externalId);
    if (input.internalEntityId) {
        where.internalEntityId = String(input.internalEntityId);
    }

    return IntegrationEntitySyncEvent.findAll({
        where,
        order: [['createdAt', 'DESC']],
        limit: Math.min(50, Math.max(1, input.limit ?? 20)),
    });
}

export async function listEntitySyncEventsByExternalIds(
    provider: string,
    externalIds: string[],
    limitPerEntity = 1
): Promise<Map<string, IntegrationEntitySyncEvent>> {
    const map = new Map<string, IntegrationEntitySyncEvent>();
    if (externalIds.length === 0) return map;

    const rows = await IntegrationEntitySyncEvent.findAll({
        where: {
            provider: provider.toUpperCase(),
            entityType: 'RESERVATION',
            externalId: { [Op.in]: externalIds },
        },
        order: [['createdAt', 'DESC']],
        limit: externalIds.length * Math.max(1, limitPerEntity) * 3,
    });

    for (const row of rows) {
        if (!map.has(row.externalId)) {
            map.set(row.externalId, row);
        }
    }
    return map;
}
