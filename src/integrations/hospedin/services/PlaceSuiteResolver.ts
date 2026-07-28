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
 * ValidationService e ReservationSyncExecutor (futuro) devem usar apenas este resolver.
 * NÃO acessar HospedinPlaceSuiteMap / Sequelize de mapeamento fora daqui (exceto CRUD admin).
 */
export class PlaceSuiteResolver {
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

        const map = await hospedinPlaceSuiteMapService.findActiveByPlaceId(id);
        if (!map) {
            return {
                found: false,
                placeId: id,
                reason: 'INACTIVE_OR_MISSING',
                message: `Nenhum mapeamento ativo Hospedin place_id=${id} → EventoSuite.`,
            };
        }

        return {
            found: true,
            placeId: id,
            idEventoSuite: Number(map.id_evento_suite),
            idEvento: map.id_evento != null ? Number(map.id_evento) : null,
            mapId: Number(map.id),
            mappedAt: map.mapped_at,
            mappedBy: map.mapped_by != null ? Number(map.mapped_by) : null,
        };
    }
}

export const placeSuiteResolver = new PlaceSuiteResolver();
