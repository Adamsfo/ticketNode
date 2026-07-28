import { Op } from 'sequelize';
import { EventoSuite } from '../../../models/EventoSuite';
import { HospedinPlace } from '../../../models/HospedinPlace';
import { HospedinPlaceSuiteMap } from '../../../models/HospedinPlaceSuiteMap';
import { CustomError } from '../../../utils/customError';
import { HospedinLogger } from '../logger/HospedinLogger';
import { hospedinSyncLogService } from './HospedinSyncLogService';

export type CreatePlaceSuiteMapInput = {
    placeId: number;
    idEventoSuite: number;
    notes?: string | null;
    mappedBy?: number | null;
};

export type UpdatePlaceSuiteMapInput = {
    idEventoSuite?: number;
    notes?: string | null;
    mappedBy?: number | null;
};

export type UnmappedPlaceSuggestion = {
    idEventoSuite: number;
    nome: string;
    idEvento: number;
    score: number;
};

export type UnmappedPlaceItem = {
    placeId: number;
    nome: string;
    placeTypeId: number | null;
    capacidade: number | null;
    suggestion: UnmappedPlaceSuggestion | null;
};

function normalizeName(value: string): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/** Similaridade simples (Dice bigrams) 0..1 — só sugestão, nunca auto-vínculo. */
function nameSimilarity(a: string, b: string): number {
    const left = normalizeName(a);
    const right = normalizeName(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.includes(right) || right.includes(left)) return 0.85;

    const bigrams = (s: string): Map<string, number> => {
        const map = new Map<string, number>();
        for (let i = 0; i < s.length - 1; i++) {
            const g = s.slice(i, i + 2);
            map.set(g, (map.get(g) || 0) + 1);
        }
        return map;
    };

    const A = bigrams(left);
    const B = bigrams(right);
    let intersection = 0;
    for (const [g, count] of A) {
        const other = B.get(g) || 0;
        intersection += Math.min(count, other);
    }
    const total = [...A.values()].reduce((s, n) => s + n, 0) +
        [...B.values()].reduce((s, n) => s + n, 0);
    if (total === 0) return 0;
    return (2 * intersection) / total;
}

/**
 * Persistência administrativa do vínculo place Hospedin ↔ EventoSuite.
 *
 * Resolução para Validation / Executor / sync:
 * usar SEMPRE PlaceSuiteResolver.resolveInternalSuite(placeId).
 * Este service não é a porta de resolução do pipeline.
 *
 * Não cria/altera reservas. Não altera EventoSuite (só leitura).
 */
export class HospedinPlaceSuiteMapService {
    async findById(id: number): Promise<HospedinPlaceSuiteMap | null> {
        return HospedinPlaceSuiteMap.findByPk(id);
    }

    async findByPlaceId(
        placeId: number,
        options?: { onlyActive?: boolean }
    ): Promise<HospedinPlaceSuiteMap | null> {
        const where: Record<string, unknown> = { place_id: placeId };
        if (options?.onlyActive !== false) {
            where.ativo = true;
        }
        return HospedinPlaceSuiteMap.findOne({ where });
    }

    async findActiveByPlaceId(
        placeId: number
    ): Promise<HospedinPlaceSuiteMap | null> {
        return this.findByPlaceId(placeId, { onlyActive: true });
    }

    async findByEventoSuiteId(
        idEventoSuite: number,
        options?: { onlyActive?: boolean }
    ): Promise<HospedinPlaceSuiteMap | null> {
        const where: Record<string, unknown> = {
            id_evento_suite: idEventoSuite,
        };
        if (options?.onlyActive !== false) {
            where.ativo = true;
        }
        return HospedinPlaceSuiteMap.findOne({ where });
    }

    async list(filters?: {
        ativo?: boolean;
        idEvento?: number;
        limit?: number;
        offset?: number;
    }): Promise<HospedinPlaceSuiteMap[]> {
        const where: Record<string, unknown> = {};
        if (filters?.ativo !== undefined) where.ativo = filters.ativo;
        if (filters?.idEvento != null) where.id_evento = filters.idEvento;

        return HospedinPlaceSuiteMap.findAll({
            where,
            order: [['updated_at', 'DESC']],
            limit: filters?.limit ?? 200,
            offset: filters?.offset ?? 0,
        });
    }

    async listUnmappedPlaces(options?: {
        idEvento?: number;
        limit?: number;
    }): Promise<UnmappedPlaceItem[]> {
        const mapped = await HospedinPlaceSuiteMap.findAll({
            where: { ativo: true },
            attributes: ['place_id'],
        });
        const mappedIds = new Set(
            mapped.map((m) => Number(m.place_id)).filter((n) => Number.isFinite(n))
        );

        const places = await HospedinPlace.findAll({
            order: [['nome', 'ASC']],
            limit: options?.limit ?? 500,
        });

        const suiteWhere: Record<string, unknown> = {};
        if (options?.idEvento != null) {
            suiteWhere.idEvento = options.idEvento;
        }
        const suites = await EventoSuite.findAll({
            where: suiteWhere,
            attributes: ['id', 'nome', 'idEvento'],
            order: [['nome', 'ASC']],
        });

        const alreadyMappedSuiteIds = new Set(
            (
                await HospedinPlaceSuiteMap.findAll({
                    where: { ativo: true },
                    attributes: ['id_evento_suite'],
                })
            ).map((m) => Number(m.id_evento_suite))
        );

        const availableSuites = suites.filter(
            (s) => !alreadyMappedSuiteIds.has(Number(s.id))
        );

        const items: UnmappedPlaceItem[] = [];
        for (const place of places) {
            const placeId = Number(place.place_id);
            if (mappedIds.has(placeId)) continue;

            const suggestion = this.suggestSuite(place.nome, availableSuites);
            items.push({
                placeId,
                nome: place.nome,
                placeTypeId: place.place_type_id,
                capacidade: place.capacidade,
                suggestion,
            });
        }

        return items;
    }

    async create(input: CreatePlaceSuiteMapInput): Promise<HospedinPlaceSuiteMap> {
        const placeId = Number(input.placeId);
        const idEventoSuite = Number(input.idEventoSuite);

        if (!Number.isFinite(placeId) || placeId <= 0) {
            throw new CustomError('placeId inválido.', 400, 'HOSPEDIN_MAPPING');
        }
        if (!Number.isFinite(idEventoSuite) || idEventoSuite <= 0) {
            throw new CustomError(
                'idEventoSuite inválido.',
                400,
                'HOSPEDIN_MAPPING'
            );
        }

        const place = await HospedinPlace.findOne({
            where: { place_id: placeId },
        });
        if (!place) {
            throw new CustomError(
                `Place Hospedin ${placeId} não encontrado no staging.`,
                404,
                'HOSPEDIN_MAPPING'
            );
        }

        const suite = await EventoSuite.findByPk(idEventoSuite);
        if (!suite) {
            throw new CustomError(
                `EventoSuite id=${idEventoSuite} não encontrada.`,
                404,
                'HOSPEDIN_MAPPING'
            );
        }

        const placeRow = await HospedinPlaceSuiteMap.findOne({
            where: { place_id: placeId },
        });
        const suiteRow = await HospedinPlaceSuiteMap.findOne({
            where: { id_evento_suite: idEventoSuite },
        });

        // Conflitos ativos: não sobrescrever vínculo em uso.
        if (placeRow?.ativo) {
            throw new CustomError(
                `Já existe mapeamento ativo para place_id=${placeId}.`,
                409,
                'HOSPEDIN_MAPPING'
            );
        }
        if (suiteRow?.ativo) {
            throw new CustomError(
                `EventoSuite id=${idEventoSuite} já está mapeada para place_id=${suiteRow.place_id}.`,
                409,
                'HOSPEDIN_MAPPING'
            );
        }

        // UNIQUE absoluto + soft deactivate → reutilizar linhas inativas (histórico).
        if (placeRow && suiteRow && placeRow.id !== suiteRow.id) {
            return this.mergeInactiveRows({
                placeRow,
                suiteRow,
                placeId,
                idEventoSuite,
                notes: input.notes,
                mappedBy: input.mappedBy,
                suite,
            });
        }

        if (placeRow) {
            return this.reactivateAndRemap(placeRow, {
                idEventoSuite,
                notes: input.notes,
                mappedBy: input.mappedBy,
                suite,
            });
        }

        if (suiteRow) {
            return this.reuseInactiveSuiteRow(suiteRow, {
                placeId,
                notes: input.notes,
                mappedBy: input.mappedBy,
                suite,
            });
        }

        const now = new Date();
        const row = await HospedinPlaceSuiteMap.create({
            provider: 'HOSPEDIN',
            place_id: placeId,
            id_evento_suite: idEventoSuite,
            id_evento: suite.idEvento ?? null,
            ativo: true,
            notes: input.notes ?? null,
            mapped_at: now,
            mapped_by: input.mappedBy ?? null,
            created_at: now,
            updated_at: now,
        });

        await this.logChange({
            operacao: 'place_suite_map_create',
            row,
            reason: 'Mapeamento criado',
        });

        return row;
    }

    async update(
        id: number,
        input: UpdatePlaceSuiteMapInput
    ): Promise<HospedinPlaceSuiteMap> {
        const row = await this.findById(id);
        if (!row) {
            throw new CustomError(
                `Mapeamento id=${id} não encontrado.`,
                404,
                'HOSPEDIN_MAPPING'
            );
        }

        const patch: Partial<HospedinPlaceSuiteMap> = {
            updated_at: new Date(),
        };

        if (input.notes !== undefined) {
            patch.notes = input.notes;
        }

        if (input.idEventoSuite != null) {
            const idEventoSuite = Number(input.idEventoSuite);
            if (!Number.isFinite(idEventoSuite) || idEventoSuite <= 0) {
                throw new CustomError(
                    'idEventoSuite inválido.',
                    400,
                    'HOSPEDIN_MAPPING'
                );
            }

            const suite = await EventoSuite.findByPk(idEventoSuite);
            if (!suite) {
                throw new CustomError(
                    `EventoSuite id=${idEventoSuite} não encontrada.`,
                    404,
                    'HOSPEDIN_MAPPING'
                );
            }

            const conflict = await HospedinPlaceSuiteMap.findOne({
                where: {
                    id_evento_suite: idEventoSuite,
                    id: { [Op.ne]: id },
                },
            });
            if (conflict) {
                if (conflict.ativo) {
                    throw new CustomError(
                        `EventoSuite id=${idEventoSuite} já está vinculada ao mapeamento id=${conflict.id}.`,
                        409,
                        'HOSPEDIN_MAPPING'
                    );
                }
                // Libera UNIQUE trocando a suíte atual desta linha para o registro inativo.
                await conflict.update({
                    id_evento_suite: row.id_evento_suite,
                    id_evento: row.id_evento,
                    updated_at: new Date(),
                });
            }

            patch.id_evento_suite = idEventoSuite;
            patch.id_evento = suite.idEvento ?? null;
            patch.mapped_at = new Date();
            if (input.mappedBy !== undefined) {
                patch.mapped_by = input.mappedBy;
            }
        } else if (input.mappedBy !== undefined) {
            patch.mapped_by = input.mappedBy;
        }

        await row.update(patch);

        await this.logChange({
            operacao: 'place_suite_map_update',
            row,
            reason: 'Mapeamento atualizado',
        });

        return row;
    }

    async deactivate(
        id: number,
        mappedBy?: number | null
    ): Promise<HospedinPlaceSuiteMap> {
        const row = await this.findById(id);
        if (!row) {
            throw new CustomError(
                `Mapeamento id=${id} não encontrado.`,
                404,
                'HOSPEDIN_MAPPING'
            );
        }

        await row.update({
            ativo: false,
            mapped_by: mappedBy !== undefined ? mappedBy : row.mapped_by,
            updated_at: new Date(),
        });

        await this.logChange({
            operacao: 'place_suite_map_deactivate',
            row,
            reason: 'Mapeamento desativado (soft)',
        });

        return row;
    }

    async activate(
        id: number,
        mappedBy?: number | null
    ): Promise<HospedinPlaceSuiteMap> {
        const row = await this.findById(id);
        if (!row) {
            throw new CustomError(
                `Mapeamento id=${id} não encontrado.`,
                404,
                'HOSPEDIN_MAPPING'
            );
        }

        const placeConflict = await HospedinPlaceSuiteMap.findOne({
            where: {
                place_id: row.place_id,
                ativo: true,
                id: { [Op.ne]: id },
            },
        });
        if (placeConflict) {
            throw new CustomError(
                `Já existe mapeamento ativo para place_id=${row.place_id}.`,
                409,
                'HOSPEDIN_MAPPING'
            );
        }

        const suiteConflict = await HospedinPlaceSuiteMap.findOne({
            where: {
                id_evento_suite: row.id_evento_suite,
                ativo: true,
                id: { [Op.ne]: id },
            },
        });
        if (suiteConflict) {
            throw new CustomError(
                `EventoSuite id=${row.id_evento_suite} já está mapeada ativamente.`,
                409,
                'HOSPEDIN_MAPPING'
            );
        }

        const now = new Date();
        await row.update({
            ativo: true,
            mapped_at: now,
            mapped_by: mappedBy !== undefined ? mappedBy : row.mapped_by,
            updated_at: now,
        });

        await this.logChange({
            operacao: 'place_suite_map_activate',
            row,
            reason: 'Mapeamento reativado',
        });

        return row;
    }

    private async reactivateAndRemap(
        row: HospedinPlaceSuiteMap,
        input: {
            idEventoSuite: number;
            notes?: string | null;
            mappedBy?: number | null;
            suite: EventoSuite;
        }
    ): Promise<HospedinPlaceSuiteMap> {
        const suiteConflict = await HospedinPlaceSuiteMap.findOne({
            where: {
                id_evento_suite: input.idEventoSuite,
                id: { [Op.ne]: row.id },
            },
        });
        if (suiteConflict) {
            if (suiteConflict.ativo) {
                throw new CustomError(
                    `EventoSuite id=${input.idEventoSuite} já está vinculada ao mapeamento id=${suiteConflict.id}.`,
                    409,
                    'HOSPEDIN_MAPPING'
                );
            }
            // Libera UNIQUE(id_evento_suite) trocando a suíte antiga para a linha inativa.
            await suiteConflict.update({
                id_evento_suite: row.id_evento_suite,
                id_evento: row.id_evento,
                updated_at: new Date(),
            });
        }

        const now = new Date();
        await row.update({
            id_evento_suite: input.idEventoSuite,
            id_evento: input.suite.idEvento ?? null,
            ativo: true,
            notes: input.notes !== undefined ? input.notes : row.notes,
            mapped_at: now,
            mapped_by: input.mappedBy ?? row.mapped_by,
            updated_at: now,
        });

        await this.logChange({
            operacao: 'place_suite_map_reactivate',
            row,
            reason: 'Mapeamento inativo reativado/remapeado',
        });

        return row;
    }

    /**
     * Reutiliza linha inativa que já ocupa UNIQUE(id_evento_suite),
     * apontando-a para o novo place_id.
     */
    private async reuseInactiveSuiteRow(
        row: HospedinPlaceSuiteMap,
        input: {
            placeId: number;
            notes?: string | null;
            mappedBy?: number | null;
            suite: EventoSuite;
        }
    ): Promise<HospedinPlaceSuiteMap> {
        const now = new Date();
        await row.update({
            place_id: input.placeId,
            id_evento: input.suite.idEvento ?? null,
            ativo: true,
            notes: input.notes !== undefined ? input.notes : row.notes,
            mapped_at: now,
            mapped_by: input.mappedBy ?? row.mapped_by,
            updated_at: now,
        });

        await this.logChange({
            operacao: 'place_suite_map_reuse_suite',
            row,
            reason: 'Linha inativa da suíte reutilizada com novo place_id',
        });

        return row;
    }

    /**
     * Duas linhas inativas bloqueando UNIQUE(place_id) e UNIQUE(id_evento_suite).
     * Consolida o vínculo desejado na linha do place; a outra permanece inativa
     * com a suíte antiga (histórico preservado, sem delete físico).
     */
    private async mergeInactiveRows(input: {
        placeRow: HospedinPlaceSuiteMap;
        suiteRow: HospedinPlaceSuiteMap;
        placeId: number;
        idEventoSuite: number;
        notes?: string | null;
        mappedBy?: number | null;
        suite: EventoSuite;
    }): Promise<HospedinPlaceSuiteMap> {
        const { placeRow, suiteRow } = input;
        const now = new Date();
        const previousSuiteId = placeRow.id_evento_suite;
        const previousEventoId = placeRow.id_evento;

        await suiteRow.update({
            id_evento_suite: previousSuiteId,
            id_evento: previousEventoId,
            updated_at: now,
        });

        await placeRow.update({
            place_id: input.placeId,
            id_evento_suite: input.idEventoSuite,
            id_evento: input.suite.idEvento ?? null,
            ativo: true,
            notes: input.notes !== undefined ? input.notes : placeRow.notes,
            mapped_at: now,
            mapped_by: input.mappedBy ?? placeRow.mapped_by,
            updated_at: now,
        });

        await this.logChange({
            operacao: 'place_suite_map_merge_inactive',
            row: placeRow,
            reason: `Merge de linhas inativas; linha id=${suiteRow.id} ficou com suíte anterior`,
        });

        return placeRow;
    }

    private suggestSuite(
        placeName: string,
        suites: EventoSuite[]
    ): UnmappedPlaceSuggestion | null {
        const MIN_SCORE = 0.55;
        let best: UnmappedPlaceSuggestion | null = null;

        for (const suite of suites) {
            const score = nameSimilarity(placeName, suite.nome);
            if (score < MIN_SCORE) continue;
            if (!best || score > best.score) {
                best = {
                    idEventoSuite: Number(suite.id),
                    nome: suite.nome,
                    idEvento: Number(suite.idEvento),
                    score: Number(score.toFixed(3)),
                };
            }
        }

        return best;
    }

    private async logChange(input: {
        operacao: string;
        row: HospedinPlaceSuiteMap;
        reason: string;
    }): Promise<void> {
        HospedinLogger.info('place_suite_map:change', {
            id: input.row.id,
            place_id: input.row.place_id,
            id_evento_suite: input.row.id_evento_suite,
            ativo: input.row.ativo,
            mapped_by: input.row.mapped_by,
            reason: input.reason,
            operacao: input.operacao,
        });

        await hospedinSyncLogService.write({
            operacao: input.operacao,
            endpoint: null,
            metodo: null,
            request: {
                id: input.row.id,
                place_id: input.row.place_id,
                id_evento_suite: input.row.id_evento_suite,
            },
            response: {
                ativo: input.row.ativo,
                reason: input.reason,
                mapped_at: input.row.mapped_at,
                mapped_by: input.row.mapped_by,
            },
            status: 200,
            duracaoMs: 0,
            sucesso: true,
        });
    }
}

export const hospedinPlaceSuiteMapService = new HospedinPlaceSuiteMapService();
