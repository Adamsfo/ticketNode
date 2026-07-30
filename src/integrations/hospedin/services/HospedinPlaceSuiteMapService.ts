import { Op } from 'sequelize';
import { EventoSuite } from '../../../models/EventoSuite';
import { HospedinPlace } from '../../../models/HospedinPlace';
import {
    HospedinPlaceSuiteMap,
    PlaceSuiteMappingStatus,
} from '../../../models/HospedinPlaceSuiteMap';
import {
    IntegrationEntityType,
    IntegrationSyncState,
    IntegrationSyncStatus,
} from '../../../models/IntegrationSyncState';
import { HospedinReservation } from '../../../models/HospedinReservation';
import { CustomError } from '../../../utils/customError';
import { HospedinLogger } from '../logger/HospedinLogger';
import { hospedinSyncLogService } from './HospedinSyncLogService';
import { recordEntitySyncEvent } from '../../core/EntitySyncEventService';
import {
    SyncErrorCode,
    SyncResolutionStatus,
} from '../../core/syncErrorClassification';

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
        // Ativas LINKED ou IGNORED saem da lista "sem vínculo".
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
                    where: {
                        ativo: true,
                        mapping_status: PlaceSuiteMappingStatus.LINKED,
                        id_evento_suite: { [Op.ne]: null },
                    },
                    attributes: ['id_evento_suite'],
                })
            )
                .map((m) => Number(m.id_evento_suite))
                .filter((n) => Number.isFinite(n) && n > 0)
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

    /**
     * Marca place como IGNORED: fora da operação Jango.
     * Não gera pendência; fecha WAIT_MAPPING abertas desse place.
     */
    async ignorePlace(input: {
        placeId: number;
        notes?: string | null;
        mappedBy?: number | null;
    }): Promise<HospedinPlaceSuiteMap> {
        const placeId = Number(input.placeId);
        if (!Number.isFinite(placeId) || placeId <= 0) {
            throw new CustomError('placeId inválido.', 400, 'HOSPEDIN_MAPPING');
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

        const existing = await HospedinPlaceSuiteMap.findOne({
            where: { place_id: placeId },
        });

        if (
            existing?.ativo &&
            String(existing.mapping_status).toUpperCase() ===
                PlaceSuiteMappingStatus.LINKED &&
            existing.id_evento_suite != null
        ) {
            throw new CustomError(
                `place_id=${placeId} está vinculado. Remova o vínculo antes de ignorar.`,
                409,
                'HOSPEDIN_MAPPING'
            );
        }

        if (
            existing?.ativo &&
            String(existing.mapping_status).toUpperCase() ===
                PlaceSuiteMappingStatus.IGNORED
        ) {
            return existing;
        }

        const now = new Date();
        let row: HospedinPlaceSuiteMap;

        if (existing) {
            await existing.update({
                id_evento_suite: null,
                id_evento: null,
                ativo: true,
                mapping_status: PlaceSuiteMappingStatus.IGNORED,
                notes:
                    input.notes !== undefined ? input.notes : existing.notes,
                mapped_at: now,
                mapped_by:
                    input.mappedBy !== undefined
                        ? input.mappedBy
                        : existing.mapped_by,
                updated_at: now,
            });
            row = existing;
        } else {
            row = await HospedinPlaceSuiteMap.create({
                provider: 'HOSPEDIN',
                place_id: placeId,
                id_evento_suite: null,
                id_evento: null,
                ativo: true,
                mapping_status: PlaceSuiteMappingStatus.IGNORED,
                notes: input.notes ?? null,
                mapped_at: now,
                mapped_by: input.mappedBy ?? null,
                created_at: now,
                updated_at: now,
            });
        }

        placeSuiteResolverInvalidate(placeId);

        await this.logChange({
            operacao: 'place_suite_map_ignore',
            row,
            reason: 'Suíte ignorada por configuração (fora da operação Jango)',
        });

        await this.closeOpenPendenciasForPlace(placeId);

        return row;
    }

    /**
     * Reativa suíte ignorada → volta a "sem vínculo" (exige configuração).
     */
    async unignorePlace(input: {
        id?: number;
        placeId?: number;
        mappedBy?: number | null;
    }): Promise<HospedinPlaceSuiteMap> {
        let row: HospedinPlaceSuiteMap | null = null;
        if (input.id != null) {
            row = await this.findById(Number(input.id));
        } else if (input.placeId != null) {
            row = await HospedinPlaceSuiteMap.findOne({
                where: { place_id: Number(input.placeId) },
            });
        }

        if (!row) {
            throw new CustomError(
                'Mapeamento ignorado não encontrado.',
                404,
                'HOSPEDIN_MAPPING'
            );
        }

        if (
            String(row.mapping_status).toUpperCase() !==
            PlaceSuiteMappingStatus.IGNORED
        ) {
            throw new CustomError(
                `Mapeamento id=${row.id} não está IGNORED.`,
                400,
                'HOSPEDIN_MAPPING'
            );
        }

        const now = new Date();
        await row.update({
            ativo: false,
            mapping_status: PlaceSuiteMappingStatus.IGNORED,
            mapped_at: now,
            mapped_by:
                input.mappedBy !== undefined ? input.mappedBy : row.mapped_by,
            updated_at: now,
        });

        placeSuiteResolverInvalidate(Number(row.place_id));

        await this.logChange({
            operacao: 'place_suite_map_unignore',
            row,
            reason: 'Suíte reativada — volta a exigir mapeamento',
        });

        return row;
    }

    /** Fecha pendências OPEN/WAIT_MAPPING de reservas do place ignorado. */
    private async closeOpenPendenciasForPlace(
        placeId: number
    ): Promise<number> {
        const staging = await HospedinReservation.findAll({
            attributes: ['reservation_id', 'payload_json'],
            limit: 5000,
        });

        const externalIds: string[] = [];
        for (const row of staging) {
            const payload = (row.payload_json || {}) as Record<string, unknown>;
            const pid = Number(payload.place_id);
            if (pid === placeId) {
                externalIds.push(String(row.reservation_id));
            }
        }
        if (externalIds.length === 0) return 0;

        const states = await IntegrationSyncState.findAll({
            where: {
                entity_type: IntegrationEntityType.RESERVATION,
                external_id: { [Op.in]: externalIds },
                resolution_status: SyncResolutionStatus.OPEN,
                sync_status: {
                    [Op.in]: [
                        IntegrationSyncStatus.WAIT_MAPPING,
                        IntegrationSyncStatus.FAILED,
                    ],
                },
            },
        });

        let closed = 0;
        const message = `Suíte place_id=${placeId} ignorada por configuração — sem ação operacional.`;
        for (const state of states) {
            await state.update({
                sync_status: IntegrationSyncStatus.IGNORED,
                resolution_status: SyncResolutionStatus.IGNORED,
                error_code: SyncErrorCode.SUITE_IGNORED,
                error_severityity: 'INFO',
                last_error: message,
                next_retry_at: null,
                updated_at: new Date(),
            } as any);

            await recordEntitySyncEvent({
                provider: String(state.provider),
                externalId: state.external_id,
                internalEntityId: state.internal_entity_id,
                operation: 'VALIDATE',
                result: 'IGNORED',
                errorCode: SyncErrorCode.SUITE_IGNORED,
                errorSeverity: 'INFO',
                message,
            });
            closed += 1;
        }
        return closed;
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

        // Conflitos ativos LINKED: não sobrescrever vínculo em uso.
        // IGNORED ativo pode ser convertido em LINKED.
        const placeLinked =
            placeRow?.ativo &&
            String(placeRow.mapping_status || '').toUpperCase() ===
                PlaceSuiteMappingStatus.LINKED &&
            placeRow.id_evento_suite != null;
        if (placeLinked) {
            throw new CustomError(
                `Já existe mapeamento ativo para place_id=${placeId}.`,
                409,
                'HOSPEDIN_MAPPING'
            );
        }
        if (
            suiteRow?.ativo &&
            String(suiteRow.mapping_status || '').toUpperCase() ===
                PlaceSuiteMappingStatus.LINKED
        ) {
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
            mapping_status: PlaceSuiteMappingStatus.LINKED,
            notes: input.notes ?? null,
            mapped_at: now,
            mapped_by: input.mappedBy ?? null,
            created_at: now,
            updated_at: now,
        });

        placeSuiteResolverInvalidate(placeId);

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
            patch.mapping_status = PlaceSuiteMappingStatus.LINKED;
            patch.ativo = true;
            patch.mapped_at = new Date();
            if (input.mappedBy !== undefined) {
                patch.mapped_by = input.mappedBy;
            }
        } else if (input.mappedBy !== undefined) {
            patch.mapped_by = input.mappedBy;
        }

        await row.update(patch);
        placeSuiteResolverInvalidate(Number(row.place_id));

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

        placeSuiteResolverInvalidate(Number(row.place_id));

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
                mapping_status: PlaceSuiteMappingStatus.LINKED,
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

        if (row.id_evento_suite == null) {
            throw new CustomError(
                'Não é possível reativar vínculo sem EventoSuite. Use Vincular.',
                400,
                'HOSPEDIN_MAPPING'
            );
        }

        const now = new Date();
        await row.update({
            ativo: true,
            mapping_status: PlaceSuiteMappingStatus.LINKED,
            mapped_at: now,
            mapped_by: mappedBy !== undefined ? mappedBy : row.mapped_by,
            updated_at: now,
        });

        placeSuiteResolverInvalidate(Number(row.place_id));

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
            mapping_status: PlaceSuiteMappingStatus.LINKED,
            notes: input.notes !== undefined ? input.notes : row.notes,
            mapped_at: now,
            mapped_by: input.mappedBy ?? row.mapped_by,
            updated_at: now,
        });

        placeSuiteResolverInvalidate(Number(row.place_id));

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
            mapping_status: PlaceSuiteMappingStatus.LINKED,
            notes: input.notes !== undefined ? input.notes : row.notes,
            mapped_at: now,
            mapped_by: input.mappedBy ?? row.mapped_by,
            updated_at: now,
        });

        placeSuiteResolverInvalidate(input.placeId);

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
            mapping_status: PlaceSuiteMappingStatus.LINKED,
            notes: input.notes !== undefined ? input.notes : placeRow.notes,
            mapped_at: now,
            mapped_by: input.mappedBy ?? placeRow.mapped_by,
            updated_at: now,
        });

        placeSuiteResolverInvalidate(input.placeId);

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
            mapping_status: (input.row as any).mapping_status,
            ativo: input.row.ativo,
            mapped_by: input.row.mapped_by,
            mapped_at: input.row.mapped_at,
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
                mapping_status: (input.row as any).mapping_status,
            },
            response: {
                ativo: input.row.ativo,
                mapping_status: (input.row as any).mapping_status,
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

function placeSuiteResolverInvalidate(placeId?: number | null) {
    try {
        // Lazy require evita ciclo PlaceSuiteResolver ↔ MapService.
        const {
            placeSuiteResolver,
        } = require('./PlaceSuiteResolver') as typeof import('./PlaceSuiteResolver');
        placeSuiteResolver.invalidate(placeId);
    } catch {
        // ignore
    }
}

export const hospedinPlaceSuiteMapService = new HospedinPlaceSuiteMapService();
