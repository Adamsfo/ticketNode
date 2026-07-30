import {
    listIntegrationsStatus,
    listRecentExecutions,
    runProviderCycle,
    updateProviderConfig,
    getSyncSummaryCounts,
    listSyncPendencias,
    runEntitySync,
    runEntitySyncBulk,
    listEntitySyncEvents,
    getSyncStateByExternalId,
    getSyncStateByInternalId,
    reconcileOpenPendencias,
    getProviderExecutionStats,
    getExecutionById,
    mapExecutionRow,
} from '../integrations/core';
import { IntegrationSyncTrigger } from '../models/IntegrationSyncExecution';
import { CustomError } from '../utils/customError';
import { bootstrapIntegrationProviders } from '../integrations/bootstrap';

bootstrapIntegrationProviders();

module.exports = {
    async listStatus(req: any, res: any, next: any) {
        try {
            const providers = await listIntegrationsStatus();
            const summary = await getSyncSummaryCounts();
            return res.status(200).json({
                data: {
                    providers,
                    summary,
                },
            });
        } catch (error) {
            next(error);
        }
    },

    async syncSummary(req: any, res: any, next: any) {
        try {
            const provider = req.query.provider
                ? String(req.query.provider)
                : undefined;
            const data = await getSyncSummaryCounts(provider);
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },

    async listPendencias(req: any, res: any, next: any) {
        try {
            const data = await listSyncPendencias({
                provider: req.query.provider
                    ? String(req.query.provider)
                    : undefined,
                severity: req.query.severity
                    ? String(req.query.severity)
                    : undefined,
                limit: Number(req.query.limit) || 50,
                offset: Number(req.query.offset) || 0,
            });
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },

    async reconcilePendencias(req: any, res: any, next: any) {
        try {
            const provider = req.body?.provider
                ? String(req.body.provider)
                : req.query.provider
                  ? String(req.query.provider)
                  : undefined;
            const data = await reconcileOpenPendencias({
                provider,
                limit: Number(req.body?.limit) || 5000,
            });
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },

    async listEntityEvents(req: any, res: any, next: any) {
        try {
            const provider = req.query.provider
                ? String(req.query.provider)
                : undefined;
            const externalId = req.query.externalId
                ? String(req.query.externalId)
                : undefined;
            const internalEntityId = req.query.internalEntityId
                ? String(req.query.internalEntityId)
                : undefined;
            if (!externalId && !internalEntityId) {
                throw new CustomError(
                    'externalId ou internalEntityId é obrigatório.',
                    400,
                    ''
                );
            }
            const rows = await listEntitySyncEvents({
                provider,
                externalId,
                internalEntityId,
                limit: Number(req.query.limit) || 20,
            });
            return res.status(200).json({
                data: rows.map((r) => ({
                    id: r.id,
                    provider: r.provider,
                    externalId: r.externalId,
                    internalEntityId: r.internalEntityId,
                    operation: r.operation,
                    result: r.result,
                    errorCode: r.errorCode,
                    errorSeverity: r.errorSeverity,
                    message: r.message,
                    durationMs: r.durationMs,
                    correlationId: r.correlationId,
                    createdAt: r.createdAt,
                })),
            });
        } catch (error) {
            next(error);
        }
    },

    async getEntityState(req: any, res: any, next: any) {
        try {
            const provider = String(req.params.provider || '').toUpperCase();
            const externalId = String(req.params.externalId || '');
            if (!provider || !externalId) {
                throw new CustomError(
                    'provider e externalId são obrigatórios.',
                    400,
                    ''
                );
            }
            const data = await getSyncStateByExternalId(provider, externalId);
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },

    async getEntityStateByInternal(req: any, res: any, next: any) {
        try {
            const id = Number(req.params.internalId);
            if (!id) {
                throw new CustomError('internalId inválido.', 400, '');
            }
            const data = await getSyncStateByInternalId(id);
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },

    async runEntity(req: any, res: any, next: any) {
        try {
            const provider = String(req.params.provider || '').toUpperCase();
            const externalId = String(req.params.externalId || '');
            if (!provider || !externalId) {
                throw new CustomError(
                    'provider e externalId são obrigatórios.',
                    400,
                    ''
                );
            }
            const data = await runEntitySync({
                provider,
                externalId,
                refreshImport: Boolean(req.body?.refreshImport),
                trigger: 'MANUAL',
            });
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },

    async runEntityBulk(req: any, res: any, next: any) {
        try {
            const provider = String(
                req.params.provider || req.body?.provider || ''
            ).toUpperCase();
            const externalIds = Array.isArray(req.body?.externalIds)
                ? req.body.externalIds
                : [];
            if (!provider) {
                throw new CustomError('provider é obrigatório.', 400, '');
            }
            if (externalIds.length === 0) {
                throw new CustomError(
                    'externalIds deve ser um array não vazio.',
                    400,
                    ''
                );
            }
            const data = await runEntitySyncBulk({
                provider,
                externalIds,
                refreshImport: Boolean(req.body?.refreshImport),
            });
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },

    async listExecutions(req: any, res: any, next: any) {
        try {
            const provider = req.query.provider
                ? String(req.query.provider)
                : undefined;
            const trigger = req.query.trigger
                ? String(req.query.trigger)
                : undefined;
            const status = req.query.status
                ? String(req.query.status)
                : undefined;
            const limit = Number(req.query.limit) || 50;
            const offset = Number(req.query.offset) || 0;
            const rows = await listRecentExecutions({
                provider,
                trigger,
                status,
                limit,
                offset,
            });
            return res.status(200).json({
                data: rows.map(mapExecutionRow),
            });
        } catch (error) {
            next(error);
        }
    },

    async getExecution(req: any, res: any, next: any) {
        try {
            const id = Number(req.params.id);
            const row = await getExecutionById(id);
            if (!row) {
                throw new CustomError('Execução não encontrada.', 404, '');
            }
            return res.status(200).json({ data: mapExecutionRow(row) });
        } catch (error) {
            next(error);
        }
    },

    async executionStats(req: any, res: any, next: any) {
        try {
            const provider = String(
                req.params.provider || req.query.provider || ''
            )
                .trim()
                .toUpperCase();
            if (!provider) {
                throw new CustomError('provider é obrigatório.', 400, '');
            }
            const data = await getProviderExecutionStats(provider);
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },

    async runNow(req: any, res: any, next: any) {
        try {
            const provider = String(req.params.provider || '')
                .trim()
                .toUpperCase();
            if (!provider) {
                throw new CustomError('provider é obrigatório.', 400, '');
            }

            const mode = req.body?.mode ? String(req.body.mode) : undefined;
            const syncLimit =
                req.body?.syncLimit != null
                    ? Number(req.body.syncLimit)
                    : undefined;

            const result = await runProviderCycle(
                provider,
                IntegrationSyncTrigger.MANUAL,
                {
                    mode,
                    syncLimit: Number.isFinite(syncLimit)
                        ? syncLimit
                        : undefined,
                    force: true,
                }
            );

            return res.status(200).json({ data: result });
        } catch (error) {
            next(error);
        }
    },

    async webhook(req: any, res: any, next: any) {
        try {
            const provider = String(req.params.provider || '')
                .trim()
                .toUpperCase();
            if (!provider) {
                throw new CustomError('provider é obrigatório.', 400, '');
            }

            const result = await runProviderCycle(
                provider,
                IntegrationSyncTrigger.WEBHOOK,
                {
                    force: true,
                    webhookPayload: req.body,
                }
            );

            return res.status(200).json({ data: result });
        } catch (error) {
            next(error);
        }
    },

    async patchConfig(req: any, res: any, next: any) {
        try {
            const provider = String(req.params.provider || '')
                .trim()
                .toUpperCase();
            if (!provider) {
                throw new CustomError('provider é obrigatório.', 400, '');
            }

            const body = req.body || {};
            const updated = await updateProviderConfig(provider, {
                enabled:
                    body.enabled != null ? Boolean(body.enabled) : undefined,
                intervalMinutes:
                    body.intervalMinutes != null
                        ? Number(body.intervalMinutes)
                        : undefined,
                mode: body.mode != null ? String(body.mode) : undefined,
                syncLimit:
                    body.syncLimit != null
                        ? Number(body.syncLimit)
                        : undefined,
                priority:
                    body.priority != null ? Number(body.priority) : undefined,
                maxRetries:
                    body.maxRetries != null
                        ? Number(body.maxRetries)
                        : undefined,
                backoffBaseSeconds:
                    body.backoffBaseSeconds != null
                        ? Number(body.backoffBaseSeconds)
                        : undefined,
                webhookEnabled:
                    body.webhookEnabled != null
                        ? Boolean(body.webhookEnabled)
                        : undefined,
                displayName:
                    body.displayName != null
                        ? String(body.displayName)
                        : undefined,
            });

            if (!updated) {
                throw new CustomError(
                    `Configuração não encontrada para ${provider}.`,
                    404,
                    ''
                );
            }

            return res.status(200).json({
                data: {
                    provider: updated.provider,
                    displayName: updated.displayName,
                    enabled: updated.enabled,
                    intervalMinutes: updated.intervalMinutes,
                    mode: updated.mode,
                    syncLimit: updated.syncLimit,
                    priority: updated.priority,
                    maxRetries: updated.maxRetries,
                    backoffBaseSeconds: updated.backoffBaseSeconds,
                    webhookEnabled: updated.webhookEnabled,
                },
            });
        } catch (error) {
            next(error);
        }
    },
};
