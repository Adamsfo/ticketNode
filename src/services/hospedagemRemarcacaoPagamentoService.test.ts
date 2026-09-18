/**
 * node --require ts-node/register/transpile-only --test \
 *   src/services/hospedagemRemarcacaoPagamentoService.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it, mock, afterEach, beforeEach } from 'node:test';
import { Empresa } from '../models/Empresa';
import { Evento } from '../models/Evento';
import {
    HistoricoTransacao,
    Transacao,
    TransacaoPagamento,
} from '../models/Transacao';
import { ReservaHospedagem } from '../models/ReservaHospedagem';
import {
    GATEWAY_PAGAMENTO_REMARCACAO,
    montarHistoricoPixRemarcacaoCriado,
    montarIdempotencyKeyRemarcacaoPix,
} from './hospedagemRemarcacaoClientePolicy';

const tokenSplit = 'token-split-produtor-1';
const tokenTanz = 'token-tanz-default';

describe('obterAccessTokenMercadoPagoRemarcacao', () => {
    const originalEnv = process.env.MP_TANZ_ACCESS_TOKEN;

    beforeEach(() => {
        process.env.MP_TANZ_ACCESS_TOKEN = tokenTanz;
    });

    afterEach(() => {
        process.env.MP_TANZ_ACCESS_TOKEN = originalEnv;
        mock.restoreAll();
    });

    it('produtor 1 usa token split da empresa', async () => {
        mock.method(Evento, 'findByPk', async () => ({ id: 1, idProdutor: 1 }));
        mock.method(Empresa, 'findOne', async () => ({
            id: 1,
            accessToken: tokenSplit,
            refreshToken: 'refresh',
            save: async () => undefined,
        }));

        const { obterAccessTokenMercadoPagoRemarcacao } = await import(
            './hospedagemRemarcacaoPagamentoService'
        );

        const token = await obterAccessTokenMercadoPagoRemarcacao(1);
        assert.equal(token, tokenSplit);
    });

    it('produtor diferente de 1 usa token Tanz', async () => {
        mock.method(Evento, 'findByPk', async () => ({ id: 2, idProdutor: 9 }));

        const { obterAccessTokenMercadoPagoRemarcacao } = await import(
            './hospedagemRemarcacaoPagamentoService'
        );

        const token = await obterAccessTokenMercadoPagoRemarcacao(2);
        assert.equal(token, tokenTanz);
    });
});

describe('consultarPagamentoMercadoPagoRemarcacao', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('consulta PIX com o mesmo token usado na criação (produtor 1)', async () => {
        mock.method(Evento, 'findByPk', async () => ({ id: 1, idProdutor: 1 }));
        mock.method(Empresa, 'findOne', async () => ({
            id: 1,
            accessToken: tokenSplit,
        }));

        const fetchMock = mock.fn(async () => ({
            ok: true,
            json: async () => ({ id: '999', status: 'pending' }),
        }));
        mock.method(globalThis, 'fetch', fetchMock);

        const { consultarPagamentoMercadoPagoRemarcacao } = await import(
            './hospedagemRemarcacaoPagamentoService'
        );

        const data = await consultarPagamentoMercadoPagoRemarcacao('999', 1);
        assert.equal(data.status, 'pending');
        assert.equal(fetchMock.mock.calls.length, 1);
        assert.match(
            String(fetchMock.mock.calls[0].arguments[1]?.headers?.Authorization),
            /Bearer token-split-produtor-1/
        );
    });
});

describe('buscarPaymentIdPixRemarcacaoPorTaxa', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('localiza paymentId do histórico com gateway isolado', async () => {
        const paymentId = '123456789';
        const idTaxa = 77;
        const idTransacao = 500;

        mock.method(HistoricoTransacao, 'findAll', async () => [
            {
                descricao: montarHistoricoPixRemarcacaoCriado(idTaxa, paymentId),
            },
        ]);
        mock.method(TransacaoPagamento, 'findOne', async (args: {
            where: { PagamentoCodigo: string; gatewayPagamento: string };
        }) => {
            assert.equal(args.where.PagamentoCodigo, paymentId);
            assert.equal(args.where.gatewayPagamento, GATEWAY_PAGAMENTO_REMARCACAO);
            return { id: 1 };
        });

        const { buscarPaymentIdPixRemarcacaoPorTaxa } = await import(
            './hospedagemRemarcacaoPagamentoService'
        );

        const encontrado = await buscarPaymentIdPixRemarcacaoPorTaxa(
            idTransacao,
            idTaxa
        );
        assert.equal(encontrado, paymentId);
    });
});

describe('statusPixRemarcacaoReutilizavel', () => {
    it('permite reutilizar PIX pendente/in_process/authorized', async () => {
        const { statusPixRemarcacaoReutilizavel } = await import(
            './hospedagemRemarcacaoPagamentoService'
        );

        assert.equal(statusPixRemarcacaoReutilizavel('pending'), true);
        assert.equal(statusPixRemarcacaoReutilizavel('in_process'), true);
        assert.equal(statusPixRemarcacaoReutilizavel('authorized'), true);
        assert.equal(statusPixRemarcacaoReutilizavel('approved'), false);
        assert.equal(statusPixRemarcacaoReutilizavel('cancelled'), false);
    });

    it('idempotency key da taxa é estável entre tentativas', () => {
        assert.equal(
            montarIdempotencyKeyRemarcacaoPix(77),
            montarIdempotencyKeyRemarcacaoPix(77)
        );
    });
});
