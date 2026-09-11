import {
    HOSPEDIN_JANGO_SALE_ITEM_ID,
    HOSPEDIN_JANGO_SALE_SELLING_POINT_ID,
} from '../constants/saleConstants';

export type HospedinOutboundSaleInput = {
    item_id: number;
    selling_point_id: number;
    quantity: number;
    price_cents: number;
};

/** Centavos a partir de `ReservaHospedagem.valorTotal` (fonte única). */
export function valorTotalToSalePriceCents(valorTotal: unknown): number {
    const n = Number(valorTotal ?? 0);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
}

export function resolveOutboundSalePriceCents(hospedagem: {
    valorTotal?: unknown;
}): number {
    return valorTotalToSalePriceCents(hospedagem.valorTotal);
}

export function filterOutboundJangoItemSales<
    T extends { item_id?: unknown }
>(sales: T[]): T[] {
    return sales.filter(
        (sale) => Number(sale.item_id) === HOSPEDIN_JANGO_SALE_ITEM_ID
    );
}

export function buildOutboundSalePayload(priceCents: number): HospedinOutboundSaleInput {
    return {
        item_id: HOSPEDIN_JANGO_SALE_ITEM_ID,
        selling_point_id: HOSPEDIN_JANGO_SALE_SELLING_POINT_ID,
        quantity: 1,
        price_cents: Math.max(0, Math.floor(Number(priceCents) || 0)),
    };
}
