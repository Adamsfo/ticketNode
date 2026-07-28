import { HospedinReservation } from '../../../models/HospedinReservation';
import { getHospedinConfig } from '../constants/config';
import type { HospedinImportResult } from '../dto';
import { HospedinLogger } from '../logger/HospedinLogger';
import { HospedinReservationMapper } from '../mapper/HospedinReservationMapper';
import {
    getOperationalSyncWindow,
    isWithinOperationalSyncWindow,
    parseHospedinSyncMode,
    type HospedinSyncMode,
} from '../utils/operationalSyncWindow';
import { hospedinAuthService } from './HospedinAuthService';
import {
    enrichReservationDtoWithPrimaryGuest,
    type HospedinGuestDto,
} from './HospedinGuestService';
import { hospedinReservationService } from './HospedinReservationService';
import { hospedinSyncLogService } from './HospedinSyncLogService';

export type ImportReservationsOptions = {
    /** Se true, enriquece cada item com GET /reservations/{id}. */
    fetchDetails?: boolean;
    /**
     * incremental (padrão): filtra localmente pela janela operacional.
     * full: processa todas as reservas retornadas pela API.
     */
    mode?: HospedinSyncMode | string;
};

/**
 * Importa reservations → hospedin_reservations (staging only).
 * Não cria/altera ReservaHospedagem nem chama services do Jango.
 *
 * Incremental (padrão): após listar todas as páginas, descarta reservas fora
 * da janela (check-in >= hoje OU checkout >= hoje - historicalSyncDays)
 * antes de fetchDetails / guest enrich / upsert / validate / sync.
 *
 * Full: ignora o filtro e processa absolutamente todas.
 */
export async function importHospedinReservations(
    options: ImportReservationsOptions = {}
): Promise<HospedinImportResult> {
    const started = Date.now();
    const operacao = 'import_reservations';
    const fetchDetails = options.fetchDetails === true;
    const mode = parseHospedinSyncMode(options.mode, 'incremental');
    const historicalSyncDays = getHospedinConfig().historicalSyncDays;
    const window = getOperationalSyncWindow(new Date(), historicalSyncDays);
    let accountId: string | null = null;

    try {
        await hospedinAuthService.ensureAuthenticated();
        accountId = await hospedinAuthService.ensureAccountId();
        HospedinLogger.info('import reservations iniciado', {
            accountId,
            fetchDetails,
            mode,
            historicalSyncDays,
            todayStart: window.todayStart.toISOString(),
            historyCutoff: window.historyCutoff.toISOString(),
        });

        let dtos = await hospedinReservationService.listAllReservations(
            accountId
        );
        const fetchedFromApi = dtos.length;
        let discarded = 0;

        if (mode === 'incremental') {
            const kept = [];
            for (const dto of dtos) {
                if (
                    isWithinOperationalSyncWindow(
                        dto.checkin,
                        dto.checkout,
                        window
                    )
                ) {
                    kept.push(dto);
                } else {
                    discarded += 1;
                }
            }
            dtos = kept;
            HospedinLogger.info('import reservations filtro local', {
                mode,
                fetchedFromApi,
                discarded,
                remaining: dtos.length,
                historicalSyncDays,
            });
        }

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

        const guestCache = new Map<number, HospedinGuestDto | null>();
        let guestsEnriched = 0;
        const concurrency = 6;
        const withGuests: typeof dtos = new Array(dtos.length);
        let nextIndex = 0;

        const workers = Array.from({ length: concurrency }, async () => {
            while (true) {
                const idx = nextIndex++;
                if (idx >= dtos.length) break;
                const result = await enrichReservationDtoWithPrimaryGuest(
                    dtos[idx],
                    {
                        accountId: accountId || undefined,
                        guestCache,
                    }
                );
                if (result.enriched) guestsEnriched += 1;
                withGuests[idx] = result.dto;
            }
        });
        await Promise.all(workers);
        dtos = withGuests;

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
            fetched: fetchedFromApi,
            upserted,
            accountId,
            durationMs,
            sucesso: true,
            mode,
            historicalSyncDays,
            discarded,
            remaining: dtos.length,
        };

        await hospedinSyncLogService.write({
            operacao,
            endpoint: `/api/v2/${accountId}/reservations`,
            metodo: 'GET',
            request: {
                accountId,
                fetchDetails,
                mode,
                historicalSyncDays,
            },
            response: {
                fetched: fetchedFromApi,
                discarded,
                remaining: dtos.length,
                upserted,
                guestsEnriched,
                guestCacheSize: guestCache.size,
                mode,
            },
            status: 200,
            duracaoMs: durationMs,
            sucesso: true,
        });

        HospedinLogger.info('import reservations concluído', {
            ...result,
            guestsEnriched,
        });
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
            request: {
                accountId,
                fetchDetails,
                mode,
                historicalSyncDays,
            },
            response: null,
            status: err?.status ?? 500,
            duracaoMs: durationMs,
            sucesso: false,
            erro,
        });
        throw err;
    }
}
