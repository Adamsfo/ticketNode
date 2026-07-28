import { hospedinPlaceSuiteMapService } from './HospedinPlaceSuiteMapService';

export type ResolvedInternalSuite =
    | {
          found: true;
          placeId: number;
          idEventoSuite: number;
          idEvento: number | null;
          mapId: number;
          mappedAt: Date;
          mappedBy: number | null;
      }
    | {
          found: false;
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
        const value: ResolvedInternalSuite = !map
            ? {
                  found: false,
                  placeId: id,
                  reason: 'INACTIVE_OR_MISSING',
                  message: `Nenhum mapeamento ativo Hospedin place_id=${id} → EventoSuite.`,
              }
            : {
                  found: true,
                  placeId: id,
                  idEventoSuite: Number(map.id_evento_suite),
                  idEvento:
                      map.id_evento != null ? Number(map.id_evento) : null,
                  mapId: Number(map.id),
                  mappedAt: map.mapped_at,
                  mappedBy:
                      map.mapped_by != null ? Number(map.mapped_by) : null,
              };

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
