/**
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/HospedinOutboundSaleSyncService.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HospedinApiError } from '../types/errors';
import {
    HOSPEDIN_JANGO_SALE_ITEM_ID,
    HOSPEDIN_JANGO_SALE_SELLING_POINT_ID,
} from '../constants/saleConstants';
import { HospedinOutboundSaleSyncService } from './HospedinOutboundSaleSyncService';
import type { HospedinSaleService } from '../services/HospedinSaleService';
import type { HospedinReservationService } from '../services/HospedinReservationService';

const baseCtx = {
    idReservaHospedagem: 153,
    hospedinReservationId: '30423644',
    valorTotal: 880,
    origemReserva: 'CLIENTE',
    eventoTipo: 'Pousada',
};

function createSaleServiceMock() {
    const calls = {
        list: 0,
        create: 0,
        delete: 0,
        deletedIds: [] as number[],
        sales: [] as Array<{
            id: number;
            price_cents: number;
            item_id: number;
            selling_point_id: number;
            quantity: number;
        }>,
    };

    const service: Pick<
        HospedinSaleService,
        'listSales' | 'createSale' | 'deleteSale'
    > = {
        async listSales() {
            calls.list += 1;
            return calls.sales.map((s) => ({ ...s }));
        },
        async createSale(_reservationId, input) {
            calls.create += 1;
            const created = {
                id: 9000 + calls.create,
                item_id: input.item_id,
                selling_point_id: input.selling_point_id,
                quantity: input.quantity,
                price_cents: input.price_cents,
            };
            calls.sales.push(created);
            return created;
        },
        async deleteSale(_reservationId, saleId) {
            calls.delete += 1;
            calls.deletedIds.push(Number(saleId));
            calls.sales = calls.sales.filter((s) => s.id !== Number(saleId));
        },
    };

    return { service, calls };
}

function createReservationServiceMock() {
    const service: Pick<HospedinReservationService, 'getReservationDto'> = {
        async getReservationDto() {
            return { reservationId: '30423644' } as any;
        },
    };
    return { service };
}

describe('HospedinOutboundSaleSyncService', () => {
    it('origemReserva=HOSPEDIN não sincroniza SALE', async () => {
        const saleMock = createSaleServiceMock();
        const resMock = createReservationServiceMock();
        const sync = new HospedinOutboundSaleSyncService(
            saleMock.service as HospedinSaleService,
            resMock.service as HospedinReservationService
        );

        await sync.ensureSaleAfterCreate({
            ...baseCtx,
            origemReserva: 'HOSPEDIN',
        });
        assert.equal(saleMock.calls.list, 0);
    });

    it('evento não-Pousada não sincroniza SALE', async () => {
        const saleMock = createSaleServiceMock();
        const resMock = createReservationServiceMock();
        const sync = new HospedinOutboundSaleSyncService(
            saleMock.service as HospedinSaleService,
            resMock.service as HospedinReservationService
        );

        await sync.ensureSaleAfterCreate({
            ...baseCtx,
            eventoTipo: 'Ingresso',
        });
        assert.equal(saleMock.calls.list, 0);
    });

    it('CREATE cria SALE item 810151 com valorTotal', async () => {
        const saleMock = createSaleServiceMock();
        const resMock = createReservationServiceMock();
        const sync = new HospedinOutboundSaleSyncService(
            saleMock.service as HospedinSaleService,
            resMock.service as HospedinReservationService
        );

        await sync.ensureSaleAfterCreate(baseCtx);
        assert.equal(saleMock.calls.list, 1);
        assert.equal(saleMock.calls.create, 1);
        assert.equal(saleMock.calls.delete, 0);
        assert.equal(saleMock.calls.sales[0].price_cents, 88000);
        assert.equal(saleMock.calls.sales[0].item_id, 810151);
        assert.equal(
            saleMock.calls.sales[0].selling_point_id,
            HOSPEDIN_JANGO_SALE_SELLING_POINT_ID
        );
    });

    it('CREATE noop quando única SALE 810151 já tem valor correto', async () => {
        const saleMock = createSaleServiceMock();
        saleMock.calls.sales.push({
            id: 1,
            price_cents: 88000,
            item_id: HOSPEDIN_JANGO_SALE_ITEM_ID,
            selling_point_id: HOSPEDIN_JANGO_SALE_SELLING_POINT_ID,
            quantity: 1,
        });
        const resMock = createReservationServiceMock();
        const sync = new HospedinOutboundSaleSyncService(
            saleMock.service as HospedinSaleService,
            resMock.service as HospedinReservationService
        );

        await sync.ensureSaleAfterCreate(baseCtx);
        assert.equal(saleMock.calls.create, 0);
        assert.equal(saleMock.calls.delete, 0);
    });

    it('UPDATE 530→600: DELETE SALE 810151 e POST 60000', async () => {
        const saleMock = createSaleServiceMock();
        saleMock.calls.sales.push({
            id: 55,
            price_cents: 53000,
            item_id: HOSPEDIN_JANGO_SALE_ITEM_ID,
            selling_point_id: HOSPEDIN_JANGO_SALE_SELLING_POINT_ID,
            quantity: 1,
        });
        const resMock = createReservationServiceMock();
        const sync = new HospedinOutboundSaleSyncService(
            saleMock.service as HospedinSaleService,
            resMock.service as HospedinReservationService
        );

        await sync.replaceSale({ ...baseCtx, valorTotal: 600 });
        assert.deepEqual(saleMock.calls.deletedIds, [55]);
        assert.equal(saleMock.calls.create, 1);
        assert.equal(saleMock.calls.sales.length, 1);
        assert.equal(saleMock.calls.sales[0].price_cents, 60000);
    });

    it('duas SALES item 810151: DELETE ambas e POST uma nova', async () => {
        const saleMock = createSaleServiceMock();
        saleMock.calls.sales.push(
            {
                id: 10,
                price_cents: 50000,
                item_id: HOSPEDIN_JANGO_SALE_ITEM_ID,
                selling_point_id: HOSPEDIN_JANGO_SALE_SELLING_POINT_ID,
                quantity: 1,
            },
            {
                id: 11,
                price_cents: 50000,
                item_id: HOSPEDIN_JANGO_SALE_ITEM_ID,
                selling_point_id: HOSPEDIN_JANGO_SALE_SELLING_POINT_ID,
                quantity: 1,
            }
        );
        const resMock = createReservationServiceMock();
        const sync = new HospedinOutboundSaleSyncService(
            saleMock.service as HospedinSaleService,
            resMock.service as HospedinReservationService
        );

        await sync.replaceSale({ ...baseCtx, valorTotal: 880 });
        assert.deepEqual(saleMock.calls.deletedIds.sort(), [10, 11]);
        assert.equal(saleMock.calls.create, 1);
        assert.equal(saleMock.calls.sales.length, 1);
        assert.equal(saleMock.calls.sales[0].price_cents, 88000);
    });

    it('SALE de outro item não é deletada', async () => {
        const saleMock = createSaleServiceMock();
        saleMock.calls.sales.push(
            {
                id: 10,
                price_cents: 53000,
                item_id: HOSPEDIN_JANGO_SALE_ITEM_ID,
                selling_point_id: HOSPEDIN_JANGO_SALE_SELLING_POINT_ID,
                quantity: 1,
            },
            {
                id: 99,
                price_cents: 10000,
                item_id: 415505,
                selling_point_id: HOSPEDIN_JANGO_SALE_SELLING_POINT_ID,
                quantity: 1,
            }
        );
        const resMock = createReservationServiceMock();
        const sync = new HospedinOutboundSaleSyncService(
            saleMock.service as HospedinSaleService,
            resMock.service as HospedinReservationService
        );

        await sync.replaceSale({ ...baseCtx, valorTotal: 600 });
        assert.deepEqual(saleMock.calls.deletedIds, [10]);
        assert.equal(saleMock.calls.sales.some((s) => s.id === 99), true);
        assert.equal(saleMock.calls.sales.length, 2);
    });

    it('DELETE falha → não executa POST', async () => {
        const saleMock = createSaleServiceMock();
        saleMock.calls.sales.push({
            id: 77,
            price_cents: 100,
            item_id: HOSPEDIN_JANGO_SALE_ITEM_ID,
            selling_point_id: HOSPEDIN_JANGO_SALE_SELLING_POINT_ID,
            quantity: 1,
        });
        const failingService: Pick<
            HospedinSaleService,
            'listSales' | 'createSale' | 'deleteSale'
        > = {
            listSales: saleMock.service.listSales,
            createSale: saleMock.service.createSale,
            async deleteSale() {
                saleMock.calls.delete += 1;
                throw new HospedinApiError('delete failed', 500, null);
            },
        };
        const resMock = createReservationServiceMock();
        const sync = new HospedinOutboundSaleSyncService(
            failingService as HospedinSaleService,
            resMock.service as HospedinReservationService
        );

        await assert.rejects(() => sync.replaceSale(baseCtx));
        assert.equal(saleMock.calls.delete, 1);
        assert.equal(saleMock.calls.create, 0);
    });

    it('GET sem SALE 810151 executa somente POST', async () => {
        const saleMock = createSaleServiceMock();
        const resMock = createReservationServiceMock();
        const sync = new HospedinOutboundSaleSyncService(
            saleMock.service as HospedinSaleService,
            resMock.service as HospedinReservationService
        );

        await sync.replaceSale({ ...baseCtx, valorTotal: 422.2 });
        assert.equal(saleMock.calls.delete, 0);
        assert.equal(saleMock.calls.create, 1);
        assert.equal(saleMock.calls.sales[0].price_cents, 42220);
    });

    it('retry após DELETE: GET vazio → POST nova SALE', async () => {
        const saleMock = createSaleServiceMock();
        const resMock = createReservationServiceMock();
        const sync = new HospedinOutboundSaleSyncService(
            saleMock.service as HospedinSaleService,
            resMock.service as HospedinReservationService
        );

        await sync.replaceSale({ ...baseCtx, valorTotal: 600 });
        assert.equal(saleMock.calls.delete, 0);
        assert.equal(saleMock.calls.create, 1);
        assert.equal(saleMock.calls.sales[0].price_cents, 60000);
    });

    it('DELETE ok + POST falha propaga erro para retry', async () => {
        const saleMock = createSaleServiceMock();
        saleMock.calls.sales.push({
            id: 88,
            price_cents: 100,
            item_id: HOSPEDIN_JANGO_SALE_ITEM_ID,
            selling_point_id: HOSPEDIN_JANGO_SALE_SELLING_POINT_ID,
            quantity: 1,
        });
        const failingService: Pick<
            HospedinSaleService,
            'listSales' | 'createSale' | 'deleteSale'
        > = {
            listSales: saleMock.service.listSales,
            deleteSale: saleMock.service.deleteSale,
            async createSale() {
                saleMock.calls.create += 1;
                throw new HospedinApiError('post failed', 503, null);
            },
        };
        const resMock = createReservationServiceMock();
        const sync = new HospedinOutboundSaleSyncService(
            failingService as HospedinSaleService,
            resMock.service as HospedinReservationService
        );

        await assert.rejects(() => sync.replaceSale(baseCtx));
        assert.equal(saleMock.calls.delete, 1);
        assert.equal(saleMock.calls.create, 1);
        assert.equal(saleMock.calls.sales.length, 0);
    });
});
