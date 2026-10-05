import assert from 'node:assert/strict';
import { describe, it, mock, afterEach, beforeEach } from 'node:test';
import { FormaPagamentoRecepcaoValor } from '../models/PagamentoHospedagem';

describe('persistirCaixaPagamentoHospedagem', () => {
    let garantirCalls = 0;
    let inseriCalls: unknown[][] = [];

    function resetCaches() {
        for (const p of [
            './hospedagemPagamentoService',
            './hospedagemCaixaGarantia',
            '../api/apiJango',
        ]) {
            try {
                delete require.cache[require.resolve(p)];
            } catch {
                // ignore
            }
        }
    }

    function mockDeps() {
        garantirCalls = 0;
        inseriCalls = [];

        const garantiaPath = require.resolve('./hospedagemCaixaGarantia');
        require.cache[garantiaPath] = {
            id: garantiaPath,
            filename: garantiaPath,
            loaded: true,
            exports: {
                __esModule: true,
                garantirCaixaJangoAbertoParaHospedagem: async () => {
                    garantirCalls += 1;
                    return 77;
                },
            },
        };

        const apiPath = require.resolve('../api/apiJango');
        require.cache[apiPath] = {
            id: apiPath,
            filename: apiPath,
            loaded: true,
            exports: {
                __esModule: true,
                default: () => ({
                    inseriCaixaItem: async (...args: unknown[]) => {
                        inseriCalls.push(args);
                        return 888;
                    },
                }),
            },
        };
    }

    beforeEach(() => {
        resetCaches();
        mockDeps();
    });

    afterEach(() => {
        mock.restoreAll();
        resetCaches();
    });

    async function persistirComPagamento(forma: string, idFormaEsperada?: number) {
        const { PagamentoHospedagem } = await import('../models/PagamentoHospedagem');
        mock.method(PagamentoHospedagem, 'findByPk', async () => ({
            id: 10,
            valor: 50,
            formaPagamento: forma,
            idCaixaItem: null,
            update: async () => undefined,
        }));

        const { persistirCaixaPagamentoHospedagem } = await import(
            './hospedagemPagamentoService'
        );
        const id = await persistirCaixaPagamentoHospedagem(10);
        if (idFormaEsperada != null) {
            assert.equal(garantirCalls, 1);
            assert.equal(inseriCalls.length, 1);
            assert.equal(inseriCalls[0][0], '77');
            assert.equal(inseriCalls[0][2], idFormaEsperada);
        }
        return id;
    }

    it('cenário 6: Dinheiro → garante caixa e insere item (forma 38)', async () => {
        const id = await persistirComPagamento(
            FormaPagamentoRecepcaoValor.Dinheiro,
            38
        );
        assert.equal(id, 888);
    });

    it('cenário 7: Antecipado → mesma garantia (forma 32)', async () => {
        const id = await persistirComPagamento(
            FormaPagamentoRecepcaoValor.Antecipado,
            32
        );
        assert.equal(id, 888);
    });

    it('cenário 8: PIX → não chama garantia nem inseriCaixaItem', async () => {
        const id = await persistirComPagamento(FormaPagamentoRecepcaoValor.PIX);
        assert.equal(id, null);
        assert.equal(garantirCalls, 0);
        assert.equal(inseriCalls.length, 0);
    });

    it('cenário 4 (persistir): falha na garantia → não insere CAIXA_ITEM', async () => {
        const garantiaPath = require.resolve('./hospedagemCaixaGarantia');
        require.cache[garantiaPath] = {
            id: garantiaPath,
            filename: garantiaPath,
            loaded: true,
            exports: {
                __esModule: true,
                garantirCaixaJangoAbertoParaHospedagem: async () => {
                    throw new Error('abertura negada');
                },
            },
        };

        const { PagamentoHospedagem } = await import('../models/PagamentoHospedagem');
        mock.method(PagamentoHospedagem, 'findByPk', async () => ({
            id: 10,
            valor: 50,
            formaPagamento: FormaPagamentoRecepcaoValor.Dinheiro,
            idCaixaItem: null,
            update: async () => {
                throw new Error('update não deveria ser chamado');
            },
        }));

        const { persistirCaixaPagamentoHospedagem } = await import(
            './hospedagemPagamentoService'
        );
        await assert.rejects(
            () => persistirCaixaPagamentoHospedagem(10),
            /abertura negada/
        );
        assert.equal(inseriCalls.length, 0);
    });
});
