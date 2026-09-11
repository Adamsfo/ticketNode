import { logger } from '../../../utils/logger';
import { Evento } from '../../../models/Evento';
import { HospedinPlace } from '../../../models/HospedinPlace';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundStatus,
    HospedinOutboundSyncState,
} from '../../../models/HospedinOutboundSyncState';
import { PlaceSuiteMappingStatus } from '../../../models/HospedinPlaceSuiteMap';
import { ReservaHospedagem, StatusReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaHospede } from '../../../models/ReservaHospede';
import { ReservaSuite } from '../../../models/ReservaSuite';
import { hospedinPlaceSuiteMapService } from '../services/HospedinPlaceSuiteMapService';
import {
    hospedinReservationService,
    HospedinReservationService,
} from '../services/HospedinReservationService';
import { classifyOutboundHttpError } from './hospedinOutboundErrorClassification';
import {
    buildOutboundReservationPayload,
    OUTBOUND_CREATE_DEFERRED_STATUS,
    OUTBOUND_CREATE_ELIGIBLE_STATUSES,
    OUTBOUND_CREATE_TERMINAL_STATUSES,
} from './HospedinOutboundPayloadBuilder';
import {
    hospedinOutboundGuestService,
    HospedinOutboundGuestService,
} from './HospedinOutboundGuestService';
import { hospedinOutboundStateService } from './HospedinOutboundStateService';
import {
    buildSaleSyncContextFromReserva,
    hospedinOutboundSaleSyncService,
    HospedinOutboundSaleSyncService,
} from './HospedinOutboundSaleSyncService';
import {
    buildSyncBaselineFromReserva,
    serializeHashInput,
} from './HospedinOutboundSnapshot';

const log = logger.child('HospedinOutboundCreate');

export type OutboundCreateOutcome =
    | 'created'
    | 'idempotent'
    | 'deferred'
    | 'blocked'
    | 'failed'
    | 'retry'
    | 'aborted';

export type OutboundCreateResult = {
    outcome: OutboundCreateOutcome;
    idReservaHospedagem: number;
    hospedinReservationId?: string | null;
    errorCode?: string | null;
    message?: string | null;
};

export type OutboundCreateRunOptions = {
    correlationId?: string;
    maxRetries?: number;
    backoffBaseSeconds?: number;
};

function titularGuestName(
    hospedes: Array<{ nome?: string | null }>
): string | null {
    const named = hospedes
        .map((h) => String(h.nome || '').trim())
        .filter(Boolean);
    return named[0] ?? null;
}

/**
 * CREATE real outbound Jango → Hospedin (HTTP somente aqui).
 */
type LoadedReserva = ReservaHospedagem & {
    observacaoImportada?: string | null;
    observacaoOperador?: string | null;
    observacoes?: string | null;
    origemReserva?: string | null;
    Evento?: { tipo?: string | null } | null;
    ReservaSuite?: Array<
        ReservaSuite & {
            ReservaHospede?: ReservaHospede[];
        }
    >;
};

export class HospedinOutboundCreateService {
    constructor(
        private readonly reservationService: HospedinReservationService = hospedinReservationService,
        private readonly guestService: HospedinOutboundGuestService = hospedinOutboundGuestService,
        private readonly saleSyncService: HospedinOutboundSaleSyncService = hospedinOutboundSaleSyncService
    ) {}

    async create(
        state: HospedinOutboundSyncState,
        options?: OutboundCreateRunOptions
    ): Promise<OutboundCreateResult> {
        const idReserva = Number(state.id_reserva_hospedagem);
        const stateId = Number(state.id);

        const hospedagem = await this.loadReserva(idReserva);

        if (!hospedagem) {
            return this.failPermanent(stateId, idReserva, {
                errorCode: 'RESERVA_NOT_FOUND',
                message: `ReservaHospedagem id=${idReserva} não encontrada.`,
            });
        }

        const status = String(hospedagem.status || '');

        if (status === StatusReservaHospedagem.Cancelada) {
            await hospedinOutboundStateService.markAborted(stateId, {
                errorMessage:
                    'Reserva cancelada no Jango — CREATE outbound abortado.',
                errorCode: 'CREATE_ABORTED',
            });
            return {
                outcome: 'aborted',
                idReservaHospedagem: idReserva,
                errorCode: 'CREATE_ABORTED',
                message: 'Reserva cancelada — POST Hospedin não executado.',
            };
        }

        if (OUTBOUND_CREATE_TERMINAL_STATUSES.has(status)) {
            return this.failPermanent(stateId, idReserva, {
                errorCode: 'STATUS_TERMINAL',
                message: `Status ${status} não elegível para CREATE outbound.`,
            });
        }

        if (status === OUTBOUND_CREATE_DEFERRED_STATUS) {
            await hospedinOutboundStateService.releaseToPending(stateId, {
                desiredAction: state.desired_action,
            });
            return {
                outcome: 'deferred',
                idReservaHospedagem: idReserva,
                errorCode: 'AWAITING_PAYMENT',
                message: 'Aguardando pagamento — CREATE adiado.',
            };
        }

        if (!OUTBOUND_CREATE_ELIGIBLE_STATUSES.has(status)) {
            return this.failPermanent(stateId, idReserva, {
                errorCode: 'STATUS_NOT_ELIGIBLE',
                message: `Status ${status} não permitido para CREATE outbound.`,
            });
        }

        const freshState = await HospedinOutboundSyncState.findByPk(stateId);
        const stateRow = freshState ?? state;

        const existingLink = await this.tryResolveExistingLink(
            stateRow,
            hospedagem
        );

        let hospedinReservationId: string;
        let codigoExterno: string | null =
            String(hospedagem.codigoExterno || '').trim() || null;
        let hospedinGuestId = String(stateRow.hospedin_guest_id || '').trim();

        if (existingLink) {
            hospedinReservationId = existingLink;
        } else {
        const suites = (hospedagem as any).ReservaSuite ?? [];
        const linha = suites[0] as
            | (ReservaSuite & { ReservaHospede?: ReservaHospede[] })
            | undefined;

        if (!linha) {
            return this.block(stateId, idReserva, {
                errorCode: 'SUITE_LINE_MISSING',
                message: 'Reserva sem linha de suíte para outbound.',
            });
        }

        const guestName = titularGuestName(linha.ReservaHospede ?? []);
        if (!guestName) {
            return this.block(stateId, idReserva, {
                errorCode: 'GUEST_NAME_MISSING',
                message: 'Reserva sem hóspede titular com nome.',
            });
        }

        const idEventoSuite = Number(linha.idEventoSuite);
        if (!Number.isFinite(idEventoSuite) || idEventoSuite <= 0) {
            return this.block(stateId, idReserva, {
                errorCode: 'SUITE_UNMAPPED',
                message: 'Suíte da reserva inválida para mapeamento Hospedin.',
            });
        }

        const map =
            await hospedinPlaceSuiteMapService.findByEventoSuiteId(idEventoSuite);
        if (
            !map ||
            !map.ativo ||
            String(map.mapping_status || '').toUpperCase() !==
                PlaceSuiteMappingStatus.LINKED
        ) {
            return this.block(stateId, idReserva, {
                errorCode: 'SUITE_UNMAPPED',
                message: `Suíte id=${idEventoSuite} sem mapeamento Hospedin ativo (LINKED).`,
            });
        }

        const placeId = Number(map.place_id);
        const placeRow = await HospedinPlace.findOne({
            where: { place_id: placeId },
        });
        const placeTypeId = placeRow?.place_type_id
            ? Number(placeRow.place_type_id)
            : null;

        if (!Number.isFinite(placeId) || placeId <= 0) {
            return this.block(stateId, idReserva, {
                errorCode: 'PLACE_INVALID',
                message: 'place_id inválido no mapeamento Hospedin.',
            });
        }

        if (!placeTypeId || !Number.isFinite(placeTypeId) || placeTypeId <= 0) {
            return this.block(stateId, idReserva, {
                errorCode: 'PLACE_TYPE_MISSING',
                message: `place_type_id ausente para place_id=${placeId}. Reimporte places.`,
            });
        }

        let guestId: number;
        try {
            guestId = await this.guestService.resolveOrCreateGuestId({
                outboundStateId: stateId,
                existingGuestId: stateRow.hospedin_guest_id,
                guestName,
            });
        } catch (error: unknown) {
            return this.handleHttpError(state, error, options);
        }

        const payload = buildOutboundReservationPayload({
            idReservaHospedagem: idReserva,
            checkin: new Date(hospedagem.checkin),
            checkout: new Date(hospedagem.checkout),
            observacaoImportada: (hospedagem as any).observacaoImportada,
            observacoes: hospedagem.observacoes,
            adultos: Number(linha.adultos || 0),
            criancas: Number(linha.criancas || 0),
            placeId,
            placeTypeId,
            guestId,
        });

        log.info('outbound:create:post-reservation', {
            correlationId: options?.correlationId,
            idReservaHospedagem: idReserva,
            outboundStateId: stateId,
            placeId,
            placeTypeId,
            guestId,
        });

        let created;
        try {
            created = await this.reservationService.createReservation(payload);
        } catch (error: unknown) {
            return this.handleHttpError(state, error, options);
        }

        hospedinReservationId = String(created.reservationId);
        codigoExterno = created.searchableCode ?? null;

        hospedinGuestId = String(guestId);
        await hospedinOutboundStateService.persistHospedinIds(stateId, {
            hospedinReservationId,
            hospedinGuestId,
        });

        await ReservaHospedagem.update(
            {
                idExterno: hospedinReservationId,
                codigoExterno,
            },
            { where: { id: idReserva } }
        );
        }

        return this.finalizeCreateWithSaleSync({
            state,
            stateRow,
            hospedagem,
            idReserva,
            stateId,
            hospedinReservationId,
            hospedinGuestId,
            codigoExterno,
            options,
            reservationWasCreated: !existingLink,
        });
    }

    private async loadReserva(idReserva: number): Promise<LoadedReserva | null> {
        return (await ReservaHospedagem.findByPk(idReserva, {
            include: [
                {
                    model: Evento,
                    as: 'Evento',
                    attributes: ['id', 'tipo'],
                    required: false,
                },
                {
                    model: ReservaSuite,
                    as: 'ReservaSuite',
                    include: [
                        {
                            model: ReservaHospede,
                            as: 'ReservaHospede',
                        },
                    ],
                },
            ],
        })) as LoadedReserva | null;
    }

    private async tryResolveExistingLink(
        state: HospedinOutboundSyncState,
        hospedagem: ReservaHospedagem
    ): Promise<string | null> {
        const fresh = await ReservaHospedagem.findByPk(hospedagem.id, {
            attributes: ['id', 'idExterno', 'codigoExterno'],
        });
        const idExterno = String(fresh?.idExterno || '').trim();
        const queueReservationId = String(
            state.hospedin_reservation_id || ''
        ).trim();
        const externalId = idExterno || queueReservationId;

        if (!externalId) {
            return null;
        }

        const codigoExterno =
            fresh?.codigoExterno != null
                ? String(fresh.codigoExterno)
                : null;

        if (!idExterno) {
            await ReservaHospedagem.update(
                {
                    idExterno: externalId,
                    ...(codigoExterno ? { codigoExterno } : {}),
                },
                { where: { id: hospedagem.id } }
            );
        }

        return externalId;
    }

    private async finalizeCreateWithSaleSync(input: {
        state: HospedinOutboundSyncState;
        stateRow: HospedinOutboundSyncState;
        hospedagem: LoadedReserva;
        idReserva: number;
        stateId: number;
        hospedinReservationId: string;
        hospedinGuestId: string;
        codigoExterno: string | null;
        options?: OutboundCreateRunOptions;
        reservationWasCreated: boolean;
    }): Promise<OutboundCreateResult> {
        const {
            state,
            stateRow,
            hospedagem,
            idReserva,
            stateId,
            hospedinReservationId,
            hospedinGuestId,
            codigoExterno,
            options,
            reservationWasCreated,
        } = input;

        const syncedHashInputJson = serializeHashInput(
            buildSyncBaselineFromReserva(hospedagem)
        );

        try {
            if (this.saleSyncService.shouldSyncSale(hospedagem)) {
                await this.saleSyncService.ensureSaleAfterCreate(
                    buildSaleSyncContextFromReserva(
                        hospedagem,
                        hospedinReservationId,
                        options?.correlationId
                    )
                );
            }

            const finalizeOutcome =
                await hospedinOutboundStateService.finalizeCreateAfterPost(
                    stateId,
                    {
                        hospedinReservationId,
                        hospedinGuestId,
                        syncedHashInputJson,
                    }
                );

            if (finalizeOutcome === 'pending_cancel') {
                log.info('outbound:create:pending-cancel-after-post', {
                    correlationId: options?.correlationId,
                    idReservaHospedagem: idReserva,
                    hospedinReservationId,
                });
                return {
                    outcome: reservationWasCreated ? 'created' : 'idempotent',
                    idReservaHospedagem: idReserva,
                    hospedinReservationId,
                    message:
                        'Reservation ok mas cancelamento pendente — enfileirado PENDING_CANCEL.',
                };
            }
        } catch (error: unknown) {
            return this.handleHttpError(state, error, options);
        }

        log.info(
            reservationWasCreated
                ? 'outbound:create:success'
                : 'outbound:create:idempotent',
            {
                correlationId: options?.correlationId,
                idReservaHospedagem: idReserva,
                hospedinReservationId,
                codigoExterno,
            }
        );

        return {
            outcome: reservationWasCreated ? 'created' : 'idempotent',
            idReservaHospedagem: idReserva,
            hospedinReservationId,
            message: reservationWasCreated
                ? undefined
                : 'Vínculo externo já existente — POST reservation ignorado.',
        };
    }

    private async block(
        stateId: number,
        idReserva: number,
        input: { errorCode: string; message: string }
    ): Promise<OutboundCreateResult> {
        await hospedinOutboundStateService.markBlocked(stateId, {
            errorCode: input.errorCode,
            errorMessage: input.message,
        });
        return {
            outcome: 'blocked',
            idReservaHospedagem: idReserva,
            errorCode: input.errorCode,
            message: input.message,
        };
    }

    private async failPermanent(
        stateId: number,
        idReserva: number,
        input: { errorCode: string; message: string }
    ): Promise<OutboundCreateResult> {
        await hospedinOutboundStateService.markFailed(stateId, {
            errorCode: input.errorCode,
            errorMessage: input.message,
        });
        return {
            outcome: 'failed',
            idReservaHospedagem: idReserva,
            errorCode: input.errorCode,
            message: input.message,
        };
    }

    private async handleHttpError(
        state: HospedinOutboundSyncState,
        error: unknown,
        options?: OutboundCreateRunOptions
    ): Promise<OutboundCreateResult> {
        const message = error instanceof Error ? error.message : String(error);
        const { retryable, errorCode } = classifyOutboundHttpError(error);
        const stateId = Number(state.id);
        const idReserva = Number(state.id_reserva_hospedagem);
        const maxRetries = Math.max(0, Number(options?.maxRetries) ?? 5);
        const backoffBaseSeconds = Math.max(
            1,
            Number(options?.backoffBaseSeconds) ?? 30
        );
        const nextRetryCount = Number(state.retry_count || 0) + 1;

        if (retryable && nextRetryCount <= maxRetries) {
            await hospedinOutboundStateService.markWaitRetry(stateId, {
                errorMessage: message,
                errorCode,
                retryCount: nextRetryCount,
                backoffBaseSeconds,
            });
            return {
                outcome: 'retry',
                idReservaHospedagem: idReserva,
                errorCode,
                message,
            };
        }

        await hospedinOutboundStateService.markFailed(stateId, {
            errorCode,
            errorMessage: message,
        });

        return {
            outcome: 'failed',
            idReservaHospedagem: idReserva,
            errorCode,
            message,
        };
    }
}

export const hospedinOutboundCreateService = new HospedinOutboundCreateService();
