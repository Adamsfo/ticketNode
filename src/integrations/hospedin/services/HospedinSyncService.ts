import type { HospedinImportResult } from '../dto';
import { HospedinLogger } from '../logger/HospedinLogger';
import { importHospedinPlaceTypes } from './HospedinImportPlaceTypeService';
import { importHospedinPlaces } from './HospedinImportPlaceService';
import {
    importHospedinReservations,
    type ImportReservationsOptions,
} from './HospedinImportReservationService';

/**
 * Fachada de sincronização Hospedin (Etapa 2).
 * Cada importação pode ser executada isoladamente.
 * Não há job automático nesta etapa.
 */
export class HospedinSyncService {
    async importPlaceTypes(): Promise<HospedinImportResult> {
        return importHospedinPlaceTypes();
    }

    async importPlaces(): Promise<HospedinImportResult> {
        return importHospedinPlaces();
    }

    async importReservations(
        options?: ImportReservationsOptions
    ): Promise<HospedinImportResult> {
        return importHospedinReservations(options);
    }

    /**
     * Orquestra a ordem recomendada (ainda sob demanda, sem cron):
     * Tipos → Suítes → Reservas.
     */
    async importAll(
        options?: ImportReservationsOptions
    ): Promise<{
        placeTypes: HospedinImportResult;
        places: HospedinImportResult;
        reservations: HospedinImportResult;
    }> {
        HospedinLogger.info('importAll iniciado');
        const placeTypes = await this.importPlaceTypes();
        const places = await this.importPlaces();
        const reservations = await this.importReservations(options);
        HospedinLogger.info('importAll concluído', {
            placeTypes: placeTypes.upserted,
            places: places.upserted,
            reservations: reservations.upserted,
        });
        return { placeTypes, places, reservations };
    }
}

export const hospedinSyncService = new HospedinSyncService();
