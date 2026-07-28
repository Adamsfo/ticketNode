import { HospedinReservation } from '../../../models/HospedinReservation';
import type { HospedinImportResult } from '../dto';
import { HospedinLogger } from '../logger/HospedinLogger';
import { HospedinReservationMapper } from '../mapper/HospedinReservationMapper';
import { hospedinAuthService } from './HospedinAuthService';
import { hospedinReservationService } from './HospedinReservationService';
import { hospedinSyncLogService } from './HospedinSyncLogService';

export type ImportReservationsOptions = {
    /** Se true, enriquece cada item com GET /reservations/{id}. */
    fetchDetails?: boolean;
};

/**
 * Importa reservations → hospedin_reservations (staging only).
 * Não cria/altera ReservaHospedagem nem chama services do Jango.
 */
export async function importHospedinReservations(
    options: ImportReservationsOptions = {}
): Promise<HospedinImportResult> {
    const started = Date.now();
    const operacao = 'import_reservations';
    const fetchDetails = options.fetchDetails === true;
    let accountId: string | null = null;

    try {
        await hospedinAuthService.ensureAuthenticated();
        accountId = await hospedinAuthService.ensureAccountId();
        HospedinLogger.info('import reservations iniciado', {
            accountId,
            fetchDetails,
        });

        let dtos = await hospedinReservationService.listAllReservations(
            accountId
        );

        if (fetchDetails) {
            const enriched = [];
            for (const item of dtos) {
                try {
                    enriched.push(
                        await hospedinReservationService.getReservationDto(
                            item.reservationId,
                            accountId
                        )
                    );
                } catch (err: any) {
                    HospedinLogger.warn(
                        'detalhe da reserva indisponível; mantém DTO da lista',
                        {
                            reservationId: item.reservationId,
                            message: err?.message,
                        }
                    );
                    enriched.push(item);
                }
            }
            dtos = enriched;
        }

        const now = new Date();
        let upserted = 0;

        for (const dto of dtos) {
            const existing = await HospedinReservation.findOne({
                where: { reservation_id: dto.reservationId },
            });
            const internal = HospedinReservationMapper.toInternal(
                dto,
                now,
                existing?.imported_at
            );
            await HospedinReservation.upsert(internal);
            upserted += 1;
        }

        const durationMs = Date.now() - started;
        const result: HospedinImportResult = {
            operacao,
            fetched: dtos.length,
            upserted,
            accountId,
            durationMs,
            sucesso: true,
        };

        await hospedinSyncLogService.write({
            operacao,
            endpoint: `/api/v2/${accountId}/reservations`,
            metodo: 'GET',
            request: { accountId, fetchDetails },
            response: { fetched: dtos.length, upserted },
            status: 200,
            duracaoMs: durationMs,
            sucesso: true,
        });

        HospedinLogger.info('import reservations concluído', result);
        return result;
    } catch (err: any) {
        const durationMs = Date.now() - started;
        const erro = err?.message || 'erro desconhecido';
        await hospedinSyncLogService.write({
            operacao,
            endpoint: accountId
                ? `/api/v2/${accountId}/reservations`
                : null,
            metodo: 'GET',
            request: { accountId, fetchDetails },
            response: null,
            status: err?.status ?? 500,
            duracaoMs: durationMs,
            sucesso: false,
            erro,
        });
        throw err;
    }
}
