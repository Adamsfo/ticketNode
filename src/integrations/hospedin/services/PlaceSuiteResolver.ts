import { hospedinPlaceSuiteMapService } from './HospedinPlaceSuiteMapService';
import { PlaceSuiteMappingStatus } from '../../../models/HospedinPlaceSuiteMap';

export type ResolvedInternalSuite =
    | {
          found: true;
          status: 'LINKED';
          placeId: number;
          idEventoSuite: number;
          idEvento: number | null;
          mapId: number;
          mappedAt: Date;
          mappedBy: number | null;
      }
    | {
          found: false;
          status: 'IGNORED';
          placeId: number;
          mapId: number;
          mappedAt: Date;
          mappedBy: number | null;
          reason: 'SUITE_IGNORED';
          message: string;
      }
    | {
          found: false;
          status: 'UNMAPPED';
          placeId: number | null;
          reason: 'INVALID_PLACE_ID' | 'NO_MAPPING' | 'INACTIVE_OR_MISSING';
          message: string;
      };

/**
 * Única porta de entrada do pipeline para resolver
 * Hospedin place_id → EventoSuite.id.
 *
 * ValidationService e ReservationSyncExecutor devem usar apenas este resolver.
 * NÃO acessar HospedinPlaceSuiteMap / Sequelize de mapeamento fora daqui (exceto CRUD admin).
 *
 * Cache curto em memória evita N+1 (validateAll / sync lote no mesmo place_id).
 */
export class PlaceSuiteResolver {
    private cache = new Map<
        number,
        { at: number; value: ResolvedInternalSuite }
    >();
    private static readonly CACHE_TTL_MS = 60_000;

    async resolveInternalSuite(
        placeId: number | null | undefined
    ): Promise<ResolvedInternalSuite> {
        const id = Number(placeId);
        if (!Number.isFinite(id) || id <= 0) {
            return {
                found: false,
                status: 'UNMAPPED',
                placeId: placeId == null ? null : Number(placeId) || null,
                reason: 'INVALID_PLACE_ID',
                message: 'place_id ausente ou inválido na reserva Hospedin.',
            };
        }

        const hit = this.cache.get(id);
        if (hit && Date.now() - hit.at < PlaceSuiteResolver.CACHE_TTL_MS) {
            return hit.value;
        }

        const map = await hospedinPlaceSuiteMapService.findActiveByPlaceId(id);
        let value: ResolvedInternalSuite;

        if (!map) {
            value = {
                found: false,
                status: 'UNMAPPED',
                placeId: id,
                reason: 'INACTIVE_OR_MISSING',
                message: `Nenhum mapeamento ativo Hospedin place_id=${id} → EventoSuite.`,
            };
        } else if (
            String(map.mapping_status || '').toUpperCase() ===
            PlaceSuiteMappingStatus.IGNORED
        ) {
            value = {
                found: false,
                status: 'IGNORED',
                placeId: id,
                mapId: Number(map.id),
                mappedAt: map.mapped_at,
                mappedBy:
                    map.mapped_by != null ? Number(map.mapped_by) : null,
                reason: 'SUITE_IGNORED',
                message: `Suíte Hospedin place_id=${id} ignorada por configuração — fora da operação Jango.`,
            };
        } else if (map.id_evento_suite == null) {
            value = {
                found: false,
                status: 'UNMAPPED',
                placeId: id,
                reason: 'INACTIVE_OR_MISSING',
                message: `Mapeamento place_id=${id} sem EventoSuite vinculada.`,
            };
        } else {
            value = {
                found: true,
                status: 'LINKED',
                placeId: id,
                idEventoSuite: Number(map.id_evento_suite),
                idEvento:
                    map.id_evento != null ? Number(map.id_evento) : null,
                mapId: Number(map.id),
                mappedAt: map.mapped_at,
                mappedBy:
                    map.mapped_by != null ? Number(map.mapped_by) : null,
            };
        }

        this.cache.set(id, { at: Date.now(), value });
        return value;
    }

    /** Invalida cache após CRUD do mapa place↔suíte. */
    invalidate(placeId?: number | null) {
        if (placeId != null && Number.isFinite(Number(placeId))) {
            this.cache.delete(Number(placeId));
            return;
        }
        this.cache.clear();
    }
}

export const placeSuiteResolver = new PlaceSuiteResolver();
