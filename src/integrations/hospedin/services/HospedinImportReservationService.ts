import { HospedinReservation } from '../../../models/HospedinReservation';
import type { HospedinImportResult } from '../dto';
import { HospedinLogger } from '../logger/HospedinLogger';
import { HospedinReservationMapper } from '../mapper/HospedinReservationMapper';
import {
    isCheckinAfterNow,
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
import {
    classifyStagingImportChange,
    hasInboundImportWork,
} from './hospedinStagingImportDiff';

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
 * Incremental (padrão): após listar todas as páginas, descarta reservas com
 * check-in que não é futuro (minuto, fuso hospedagem) antes de upsert.
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
    const importNow = new Date();
    let accountId: string | null = null;

    try {
        await hospedinAuthService.ensureAuthenticated();
        accountId = await hospedinAuthService.ensureAccountId();
        HospedinLogger.info('import reservations iniciado', {
            accountId,
            fetchDetails,
            mode,
            filter: 'check_in > now (minute, TZ hospedagem)',
        });

        let dtos = await hospedinReservationService.listAllReservations(
            accountId
        );
        const fetchedFromApi = dtos.length;
        let discarded = 0;

        /** Preserva sale_channel/company da lista (o detail da API omite). */
        const listChannelById = new Map<number, Record<string, unknown>>();
        for (const dto of dtos) {
            const p = dto.sourcePayload || {};
            const hints: Record<string, unknown> = {};
            if (p.sale_channel != null) hints.sale_channel = p.sale_channel;
            if (p.company != null) hints.company = p.company;
            if (p.company_name != null) hints.company_name = p.company_name;
            if (Object.keys(hints).length) {
                listChannelById.set(dto.reservationId, hints);
            }
        }

        if (mode === 'incremental') {
            const kept = [];
            for (const dto of dtos) {
                if (isCheckinAfterNow(dto.checkin, importNow)) {
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
                reason: 'check_in_not_future',
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
        dtos = withGuests.map((dto) => {
            const hints = listChannelById.get(dto.reservationId);
            if (!hints) return dto;
            const payload = { ...(dto.sourcePayload || {}) };
            for (const [k, v] of Object.entries(hints)) {
                if (payload[k] == null || payload[k] === '') payload[k] = v;
            }
            return { ...dto, sourcePayload: payload };
        });

        const now = new Date();
        let upserted = 0;
        let importCreated = 0;
        let importUpdated = 0;
        let importUnchanged = 0;

        for (const dto of dtos) {
            const existing = await HospedinReservation.findOne({
                where: { reservation_id: dto.reservationId },
            });
            const internal = HospedinReservationMapper.toInternal(
                dto,
                now,
                existing?.imported_at
            );
            const change = classifyStagingImportChange(
                existing
                    ? {
                          status: existing.status,
                          checkin: existing.checkin,
                          checkout: existing.checkout,
                          payload_json: existing.payload_json,
                      }
                    : null,
                internal
            );
            if (change === 'unchanged') {
                importUnchanged += 1;
                continue;
            }
            await HospedinReservation.upsert(internal);
            upserted += 1;
            if (change === 'created') {
                importCreated += 1;
            } else {
                importUpdated += 1;
            }
        }

        const importWorkFound = hasInboundImportWork({
            created: importCreated,
            updated: importUpdated,
        });

        const durationMs = Date.now() - started;
        const result: HospedinImportResult = {
            operacao,
            fetched: fetchedFromApi,
            upserted,
            accountId,
            durationMs,
            sucesso: true,
            mode,
            discarded,
            remaining: dtos.length,
            discardedReason:
                mode === 'incremental' ? 'check_in_not_future' : undefined,
            importCreated,
            importUpdated,
            importUnchanged,
            importWorkFound,
        };

        await hospedinSyncLogService.write({
            operacao,
            endpoint: `/api/v2/${accountId}/reservations`,
            metodo: 'GET',
            request: {
                accountId,
                fetchDetails,
                mode,
                filter:
                    mode === 'incremental'
                        ? 'check_in > now (minute)'
                        : null,
            },
            response: {
                fetched: fetchedFromApi,
                discarded,
                remaining: dtos.length,
                upserted,
                importCreated,
                importUpdated,
                importUnchanged,
                importWorkFound,
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
