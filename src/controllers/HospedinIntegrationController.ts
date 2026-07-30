import { CustomError } from '../utils/customError';
import {
    HospedinApiError,
    hospedinPlaceSuiteMapService,
    hospedinReservationValidationService,
    hospedinSyncService,
    integrationSyncStateService,
    reservationSyncRunner,
    runHospedinConnectivityTestOrThrow,
} from '../integrations/hospedin';
import { HospedinConnectivityTestError } from '../integrations/hospedin/services/HospedinConnectivityTestService';
import { IntegrationProvider } from '../models/IntegrationSyncState';

function mapHospedinError(error: any, next: any) {
    if (error instanceof HospedinConnectivityTestError) {
        return null;
    }
    if (error instanceof HospedinApiError) {
        return next(
            new CustomError(
                error.message,
                error.status || 502,
                'HOSPEDIN_API',
                error.details || {}
            )
        );
    }
    return next(error);
}

/**
 * Integração Hospedin — teste, import (staging), validação e sync-state.
 * Não altera reservas/pagamentos/disponibilidade do módulo Hospedagem.
 */
module.exports = {
    async test(req: any, res: any, next: any) {
        try {
            const result = await runHospedinConnectivityTestOrThrow();
            return res.status(200).json(result);
        } catch (error: any) {
            if (error instanceof HospedinConnectivityTestError) {
                return res.status(error.status || 502).json({
                    ...error.result,
                    message: error.message,
                });
            }
            return mapHospedinError(error, next);
        }
    },

    async importPlaceTypes(req: any, res: any, next: any) {
        try {
            const result = await hospedinSyncService.importPlaceTypes();
            return res.status(200).json(result);
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    async importPlaces(req: any, res: any, next: any) {
        try {
            const result = await hospedinSyncService.importPlaces();
            return res.status(200).json(result);
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    async importReservations(req: any, res: any, next: any) {
        try {
            const fetchDetails =
                req.body?.fetchDetails === true ||
                req.query?.fetchDetails === 'true';
            const mode = req.body?.mode ?? req.query?.mode;
            const result = await hospedinSyncService.importReservations({
                fetchDetails,
                mode,
            });
            return res.status(200).json(result);
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    /**
     * Valida staging apenas — não sincroniza com o Jango.
     * Atualiza IntegrationSyncState. Não chama Executor.
     * Body: { reservationId } | { validateAll: true, mode?: 'incremental'|'full' }
     */
    async validateReservations(req: any, res: any, next: any) {
        try {
            const validateAll =
                req.body?.validateAll === true ||
                req.query?.validateAll === 'true';

            if (validateAll) {
                const mode = req.body?.mode ?? req.query?.mode;
                const result =
                    await hospedinReservationValidationService.validateAll({
                        mode,
                    });
                return res.status(200).json(result);
            }

            const reservationId = Number(
                req.body?.reservationId ?? req.query?.reservationId
            );
            if (!Number.isFinite(reservationId) || reservationId <= 0) {
                throw new CustomError(
                    'Informe reservationId ou validateAll: true.',
                    400,
                    'HOSPEDIN_VALIDATION'
                );
            }

            const result =
                await hospedinReservationValidationService.validateReservation(
                    reservationId
                );
            return res.status(200).json(result);
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    /**
     * Lista IntegrationSyncState (Hospedin).
     * Query: syncStatus, entityType, limit, offset
     */
    async listSyncState(req: any, res: any, next: any) {
        try {
            const syncStatus = req.query?.syncStatus
                ? String(req.query.syncStatus).includes(',')
                    ? String(req.query.syncStatus)
                          .split(',')
                          .map((s: string) => s.trim())
                          .filter(Boolean)
                    : String(req.query.syncStatus)
                : undefined;
            const entityType = req.query?.entityType
                ? String(req.query.entityType)
                : undefined;
            const limit = Number(req.query?.limit || 100);
            const offset = Number(req.query?.offset || 0);

            const rows = await integrationSyncStateService.list({
                provider: IntegrationProvider.HOSPEDIN,
                entityType,
                syncStatus,
                limit: Number.isFinite(limit) ? limit : 100,
                offset: Number.isFinite(offset) ? offset : 0,
            });

            return res.status(200).json({
                total: rows.length,
                items: rows,
            });
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    async getSyncStateById(req: any, res: any, next: any) {
        try {
            const id = Number(req.params?.id);
            if (!Number.isFinite(id) || id <= 0) {
                throw new CustomError(
                    'id inválido.',
                    400,
                    'HOSPEDIN_SYNC_STATE'
                );
            }

            const row = await integrationSyncStateService.findById(id);
            if (!row || row.provider !== IntegrationProvider.HOSPEDIN) {
                throw new CustomError(
                    `IntegrationSyncState id=${id} não encontrado.`,
                    404,
                    'HOSPEDIN_SYNC_STATE'
                );
            }

            return res.status(200).json(row);
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    /**
     * Reprocessamento administrativo: apenas marca READY.
     * Não executa sincronização.
     * Body: { id } | { ids: number[] }
     */
    async reprocessSyncState(req: any, res: any, next: any) {
        try {
            const idsRaw = Array.isArray(req.body?.ids)
                ? req.body.ids
                : req.body?.id != null
                  ? [req.body.id]
                  : [];
            const ids = idsRaw
                .map((v: unknown) => Number(v))
                .filter((n: number) => Number.isFinite(n) && n > 0);

            if (ids.length === 0) {
                throw new CustomError(
                    'Informe id ou ids[] para reprocessar.',
                    400,
                    'HOSPEDIN_SYNC_STATE'
                );
            }

            const items = [];
            for (const id of ids) {
                const existing = await integrationSyncStateService.findById(id);
                if (
                    !existing ||
                    existing.provider !== IntegrationProvider.HOSPEDIN
                ) {
                    items.push({
                        id,
                        ok: false,
                        error: 'não encontrado',
                    });
                    continue;
                }

                const updated =
                    await integrationSyncStateService.reprocessToReady(
                        id,
                        'Reprocessamento administrativo → READY'
                    );
                items.push({
                    id,
                    ok: true,
                    sync_status: updated.sync_status,
                    correlation_id: updated.correlation_id,
                });
            }

            return res.status(200).json({
                message:
                    'Estado atualizado para READY. Sincronização não executada.',
                items,
            });
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    /**
     * Mapeamento place Hospedin ↔ EventoSuite (1:1).
     * Não cria reservas nem altera EventoSuite.
     */
    async listSuiteMappings(req: any, res: any, next: any) {
        try {
            /** Validação do contrato PlaceSuiteResolver (somente leitura). */
            const resolvePlaceId = req.query?.resolvePlaceId;
            if (resolvePlaceId != null && String(resolvePlaceId).trim() !== '') {
                const { placeSuiteResolver } = require('../integrations/hospedin');
                const resolved =
                    await placeSuiteResolver.resolveInternalSuite(
                        Number(resolvePlaceId)
                    );
                return res.status(200).json({ data: { resolved } });
            }

            const ativo =
                req.query?.ativo === undefined
                    ? undefined
                    : req.query.ativo === 'true' || req.query.ativo === true
                      ? true
                      : req.query.ativo === 'false' || req.query.ativo === false
                        ? false
                        : undefined;
            const idEvento =
                req.query?.idEvento != null
                    ? Number(req.query.idEvento)
                    : undefined;
            const limit = Number(req.query?.limit || 200);
            const offset = Number(req.query?.offset || 0);

            const items = await hospedinPlaceSuiteMapService.list({
                ativo,
                idEvento:
                    idEvento != null && Number.isFinite(idEvento)
                        ? idEvento
                        : undefined,
                limit: Number.isFinite(limit) ? limit : 200,
                offset: Number.isFinite(offset) ? offset : 0,
            });

            const { HospedinPlace } = require('../models/HospedinPlace');
            const { EventoSuite } = require('../models/EventoSuite');
            const placeIds = [
                ...new Set(items.map((i: any) => Number(i.place_id))),
            ];
            const suiteIds = [
                ...new Set(
                    items
                        .map((i: any) => Number(i.id_evento_suite))
                        .filter((n: number) => Number.isFinite(n) && n > 0)
                ),
            ];
            const places =
                placeIds.length > 0
                    ? await HospedinPlace.findAll({
                          where: { place_id: placeIds },
                          attributes: ['place_id', 'nome'],
                      })
                    : [];
            const suites =
                suiteIds.length > 0
                    ? await EventoSuite.findAll({
                          where: { id: suiteIds },
                          attributes: ['id', 'nome', 'idEvento'],
                      })
                    : [];
            const placeNomeById = new Map<number, string>(
                places.map((p: any) => [Number(p.place_id), String(p.nome)])
            );
            const suiteById = new Map<
                number,
                { nome: string; idEvento: number }
            >(
                suites.map((s: any) => [
                    Number(s.id),
                    { nome: String(s.nome), idEvento: Number(s.idEvento) },
                ])
            );

            const enriched = items.map((row: any) => {
                const plain = row.toJSON ? row.toJSON() : row;
                const suite = suiteById.get(Number(plain.id_evento_suite));
                return {
                    ...plain,
                    place_nome:
                        placeNomeById.get(Number(plain.place_id)) || null,
                    suite_nome: suite ? suite.nome : null,
                };
            });

            return res.status(200).json({
                data: { total: enriched.length, items: enriched },
            });
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    async listUnmappedPlaces(req: any, res: any, next: any) {
        try {
            const idEvento =
                req.query?.idEvento != null
                    ? Number(req.query.idEvento)
                    : undefined;
            const limit = Number(req.query?.limit || 500);

            const items = await hospedinPlaceSuiteMapService.listUnmappedPlaces({
                idEvento:
                    idEvento != null && Number.isFinite(idEvento)
                        ? idEvento
                        : undefined,
                limit: Number.isFinite(limit) ? limit : 500,
            });

            return res.status(200).json({
                data: {
                    total: items.length,
                    note: 'suggestion é apenas auxílio; vínculo nunca é criado automaticamente.',
                    items,
                },
            });
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    async getSuiteMappingById(req: any, res: any, next: any) {
        try {
            const id = Number(req.params?.id);
            if (!Number.isFinite(id) || id <= 0) {
                throw new CustomError('id inválido.', 400, 'HOSPEDIN_MAPPING');
            }

            const row = await hospedinPlaceSuiteMapService.findById(id);
            if (!row) {
                throw new CustomError(
                    `Mapeamento id=${id} não encontrado.`,
                    404,
                    'HOSPEDIN_MAPPING'
                );
            }

            return res.status(200).json(row);
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    async createSuiteMapping(req: any, res: any, next: any) {
        try {
            const placeId = Number(req.body?.placeId ?? req.body?.place_id);
            const idEventoSuite = Number(
                req.body?.idEventoSuite ?? req.body?.id_evento_suite
            );
            const notes =
                req.body?.notes != null ? String(req.body.notes) : null;
            const mappedBy = Number(req.user?.id) || null;

            const row = await hospedinPlaceSuiteMapService.create({
                placeId,
                idEventoSuite,
                notes,
                mappedBy,
            });

            return res.status(201).json(row);
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    async updateSuiteMapping(req: any, res: any, next: any) {
        try {
            const id = Number(req.params?.id);
            if (!Number.isFinite(id) || id <= 0) {
                throw new CustomError('id inválido.', 400, 'HOSPEDIN_MAPPING');
            }

            const idEventoSuiteRaw =
                req.body?.idEventoSuite ?? req.body?.id_evento_suite;
            const idEventoSuite =
                idEventoSuiteRaw != null ? Number(idEventoSuiteRaw) : undefined;
            const notes =
                req.body?.notes !== undefined
                    ? req.body.notes == null
                        ? null
                        : String(req.body.notes)
                    : undefined;
            const mappedBy = Number(req.user?.id) || null;

            const row = await hospedinPlaceSuiteMapService.update(id, {
                idEventoSuite,
                notes,
                mappedBy,
            });

            return res.status(200).json(row);
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    async deactivateSuiteMapping(req: any, res: any, next: any) {
        try {
            const id = Number(req.params?.id);
            if (!Number.isFinite(id) || id <= 0) {
                throw new CustomError('id inválido.', 400, 'HOSPEDIN_MAPPING');
            }

            const mappedBy = Number(req.user?.id) || null;
            const row = await hospedinPlaceSuiteMapService.deactivate(
                id,
                mappedBy
            );
            return res.status(200).json(row);
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    async ignoreSuiteMapping(req: any, res: any, next: any) {
        try {
            const placeId = Number(req.body?.placeId ?? req.body?.place_id);
            const notes =
                req.body?.notes != null ? String(req.body.notes) : null;
            const mappedBy = Number(req.user?.id) || null;

            const row = await hospedinPlaceSuiteMapService.ignorePlace({
                placeId,
                notes,
                mappedBy,
            });
            return res.status(200).json(row);
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    async unignoreSuiteMapping(req: any, res: any, next: any) {
        try {
            const id = Number(req.params?.id);
            if (!Number.isFinite(id) || id <= 0) {
                throw new CustomError('id inválido.', 400, 'HOSPEDIN_MAPPING');
            }
            const mappedBy = Number(req.user?.id) || null;
            const row = await hospedinPlaceSuiteMapService.unignorePlace({
                id,
                mappedBy,
            });
            return res.status(200).json(row);
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    async activateSuiteMapping(req: any, res: any, next: any) {
        try {
            const id = Number(req.params?.id);
            if (!Number.isFinite(id) || id <= 0) {
                throw new CustomError('id inválido.', 400, 'HOSPEDIN_MAPPING');
            }

            const mappedBy = Number(req.user?.id) || null;
            const row = await hospedinPlaceSuiteMapService.activate(
                id,
                mappedBy
            );
            return res.status(200).json(row);
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },

    /**
     * Executa sync CREATE | UPDATE | CANCEL (Orchestrator → Executor).
     * Body: { reservationId } | { limit, mode?: 'incremental'|'full' }
     * UNCHANGED / ORIGIN_CONFLICT retornam resposta controlada (sem caminho paralelo).
     * reservationId explícito ignora o filtro de janela (alvo pontual).
     */
    async syncReservations(req: any, res: any, next: any) {
        try {
            const reservationIdRaw =
                req.body?.reservationId ?? req.query?.reservationId;
            if (reservationIdRaw != null) {
                const reservationId = Number(reservationIdRaw);
                if (!Number.isFinite(reservationId) || reservationId <= 0) {
                    throw new CustomError(
                        'reservationId inválido.',
                        400,
                        'HOSPEDIN_SYNC'
                    );
                }
                const result =
                    await reservationSyncRunner.processOne(reservationId);
                return res.status(result.ok ? 200 : 422).json(result);
            }

            const limit = Number(req.body?.limit ?? req.query?.limit ?? 50);
            const mode = req.body?.mode ?? req.query?.mode;
            const result = await reservationSyncRunner.processReady({
                limit: Number.isFinite(limit) ? limit : 50,
                mode,
            });
            return res.status(200).json(result);
        } catch (error: any) {
            return mapHospedinError(error, next);
        }
    },
};
