import { logger } from '../../../utils/logger';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import {
    hospedinReservationService,
    HospedinReservationService,
} from '../services/HospedinReservationService';
import {
    hospedinSaleService,
    HospedinSaleService,
    type HospedinSaleDto,
} from '../services/HospedinSaleService';
import { isOriginEligibleForOutbound } from './hospedinOutboundOrigin';
import {
    buildOutboundSalePayload,
    filterOutboundJangoItemSales,
    resolveOutboundSalePriceCents,
} from './HospedinOutboundSalePayloadBuilder';

const log = logger.child('HospedinOutboundSaleSync');

export type SaleSyncContext = {
    idReservaHospedagem: number;
    hospedinReservationId: string;
    valorTotal: unknown;
    origemReserva?: string | null;
    eventoTipo?: string | null;
    correlationId?: string;
};

export class HospedinOutboundSaleSyncService {
    constructor(
        private readonly saleService: HospedinSaleService = hospedinSaleService,
        private readonly reservationService: HospedinReservationService = hospedinReservationService
    ) {}

    shouldSyncSale(hospedagem: {
        origemReserva?: string | null;
        Evento?: { tipo?: string | null } | null;
    }): boolean {
        return isOriginEligibleForOutbound(hospedagem);
    }

    async ensureSaleAfterCreate(ctx: SaleSyncContext): Promise<void> {
        await this.syncSale(ctx, 'create');
    }

    async replaceSale(ctx: SaleSyncContext): Promise<void> {
        await this.syncSale(ctx, 'replace');
    }

    private async syncSale(
        ctx: SaleSyncContext,
        mode: 'create' | 'replace'
    ): Promise<void> {
        if (
            !isOriginEligibleForOutbound({
                origemReserva: ctx.origemReserva,
                Evento: { tipo: ctx.eventoTipo ?? null },
            })
        ) {
            return;
        }

        const reservationId = String(ctx.hospedinReservationId || '').trim();
        if (!reservationId) {
            throw new Error('hospedinReservationId ausente para sync de SALE.');
        }

        const priceCents = resolveOutboundSalePriceCents(ctx);
        const sales = await this.saleService.listSales(reservationId);
        const jangoItemSales = filterOutboundJangoItemSales(sales);

        if (
            jangoItemSales.length === 1 &&
            Number(jangoItemSales[0].price_cents) === priceCents
        ) {
            log.info('outbound:sale:noop', {
                mode,
                correlationId: ctx.correlationId,
                idReservaHospedagem: ctx.idReservaHospedagem,
                hospedinReservationId: reservationId,
                priceCents,
            });
            await this.reservationService.getReservationDto(reservationId);
            return;
        }

        if (jangoItemSales.length > 1) {
            log.warn('outbound:sale:duplicate_item_reconcile', {
                mode,
                correlationId: ctx.correlationId,
                idReservaHospedagem: ctx.idReservaHospedagem,
                saleIds: jangoItemSales.map((s) => s.id),
            });
        }

        await this.deleteItemSales(reservationId, jangoItemSales, ctx);

        const payload = buildOutboundSalePayload(priceCents);

        log.info('outbound:sale:post', {
            mode,
            correlationId: ctx.correlationId,
            idReservaHospedagem: ctx.idReservaHospedagem,
            hospedinReservationId: reservationId,
            priceCents: payload.price_cents,
            itemId: payload.item_id,
        });

        await this.saleService.createSale(reservationId, payload);
        await this.reservationService.getReservationDto(reservationId);
    }

    private async deleteItemSales(
        reservationId: string,
        itemSales: HospedinSaleDto[],
        ctx: SaleSyncContext
    ): Promise<void> {
        for (const sale of itemSales) {
            const saleId = Number(sale.id);
            if (!Number.isFinite(saleId) || saleId <= 0) {
                continue;
            }
            log.info('outbound:sale:delete', {
                correlationId: ctx.correlationId,
                idReservaHospedagem: ctx.idReservaHospedagem,
                hospedinReservationId: reservationId,
                saleId,
                itemId: sale.item_id,
            });
            await this.saleService.deleteSale(reservationId, saleId);
        }
    }
}

export const hospedinOutboundSaleSyncService =
    new HospedinOutboundSaleSyncService();

export function buildSaleSyncContextFromReserva(
    hospedagem: ReservaHospedagem & {
        origemReserva?: string | null;
        Evento?: { tipo?: string | null } | null;
    },
    hospedinReservationId: string,
    correlationId?: string
): SaleSyncContext {
    return {
        idReservaHospedagem: Number(hospedagem.id),
        hospedinReservationId,
        valorTotal: hospedagem.valorTotal,
        origemReserva: hospedagem.origemReserva,
        eventoTipo: hospedagem.Evento?.tipo ?? null,
        correlationId,
    };
}

/** CREATE outbound — SALE usa o valor da linha de suíte, não o total da reserva. */
export function buildSaleSyncContextFromSuite(
    hospedagem: ReservaHospedagem & {
        origemReserva?: string | null;
        Evento?: { tipo?: string | null } | null;
    },
    linha: { valorTotal?: unknown },
    hospedinReservationId: string,
    correlationId?: string
): SaleSyncContext {
    return {
        idReservaHospedagem: Number(hospedagem.id),
        hospedinReservationId,
        valorTotal: linha.valorTotal,
        origemReserva: hospedagem.origemReserva,
        eventoTipo: hospedagem.Evento?.tipo ?? null,
        correlationId,
    };
}
