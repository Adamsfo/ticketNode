/**
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/HospedinOutboundSalePayloadBuilder.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    HOSPEDIN_JANGO_SALE_ITEM_ID,
    HOSPEDIN_JANGO_SALE_SELLING_POINT_ID,
} from '../constants/saleConstants';
import {
    buildOutboundSalePayload,
    filterOutboundJangoItemSales,
    resolveOutboundSalePriceCents,
    valorTotalToSalePriceCents,
} from './HospedinOutboundSalePayloadBuilder';
import { buildSyncBaselineFromReserva } from './HospedinOutboundSnapshot';

describe('HospedinOutboundSalePayloadBuilder', () => {
    it('valorTotal=422.20 gera price_cents=42220', () => {
        assert.equal(valorTotalToSalePriceCents(422.2), 42220);
    });

    it('não multiplica por noites', () => {
        assert.equal(valorTotalToSalePriceCents(880), 88000);
    });

    it('resolveOutboundSalePriceCents usa somente valorTotal', () => {
        assert.equal(
            resolveOutboundSalePriceCents({
                valorTotal: 880,
            }),
            88000
        );
        assert.equal(
            resolveOutboundSalePriceCents({
                valorTotal: 0,
            }),
            0
        );
    });

    it('não usa preco/taxaServico como fallback', () => {
        assert.equal(resolveOutboundSalePriceCents({ valorTotal: 0 }), 0);
    });

    it('monta payload SALE fixo sem note', () => {
        const payload = buildOutboundSalePayload(88000);
        assert.equal(payload.quantity, 1);
        assert.equal(payload.price_cents, 88000);
        assert.equal(payload.item_id, HOSPEDIN_JANGO_SALE_ITEM_ID);
        assert.equal(payload.selling_point_id, HOSPEDIN_JANGO_SALE_SELLING_POINT_ID);
        assert.equal(payload.item_id, 810151);
        assert.equal(payload.selling_point_id, 74977);
        assert.equal('note' in payload, false);
    });

    it('filterOutboundJangoItemSales filtra somente item 810151', () => {
        const sales = [
            { id: 1, item_id: 810151 },
            { id: 2, item_id: 415505 },
            { id: 3, item_id: 810151 },
        ];
        assert.deepEqual(
            filterOutboundJangoItemSales(sales).map((s) => s.id),
            [1, 3]
        );
    });

    it('múltiplas suites usam valor total da ReservaHospedagem', () => {
        const baseline = buildSyncBaselineFromReserva({
            valorTotal: 1500,
            preco: 1400,
            taxaServico: 100,
            checkin: new Date('2026-10-10'),
            checkout: new Date('2026-10-12'),
            ReservaSuite: [
                { idEventoSuite: 1, adultos: 2, criancas: 0, valorTotal: 900 } as any,
                { idEventoSuite: 2, adultos: 1, criancas: 0, valorTotal: 600 } as any,
            ],
        } as any);
        assert.equal(baseline.valorTotalCents, 150000);
    });
});
