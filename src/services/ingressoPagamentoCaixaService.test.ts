/**
 * node --require ts-node/register/transpile-only --test \
 *   src/services/ingressoPagamentoCaixaService.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it, mock, afterEach, beforeEach } from 'node:test';

describe('tentarLancarCaixaItemIngressoDinheiro', () => {
    let garantirCalls = 0;
    let inseriCalls: unknown[][] = [];
    let garantirRetorno = 100;
    let garantirErro: Error | null = null;
    let inseriRetorno = 5001;
    let inseriErro: Error | null = null;

    function resetCaches() {
        for (const p of [
            './ingressoPagamentoCaixaService',
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

    function aplicarMocks() {
        garantirCalls = 0;
        inseriCalls = [];
        garantirRetorno = 100;
        garantirErro = null;
        inseriRetorno = 5001;
        inseriErro = null;

        const garantiaPath = require.resolve('./hospedagemCaixaGarantia');
        require.cache[garantiaPath] = {
            id: garantiaPath,
            filename: garantiaPath,
            loaded: true,
            exports: {
                __esModule: true,
                garantirCaixaJangoAbertoParaHospedagem: async () => {
                    garantirCalls += 1;
                    if (garantirErro) {
                        throw garantirErro;
                    }
                    return garantirRetorno;
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
                        if (inseriErro) {
                            throw inseriErro;
                        }
                        return inseriRetorno;
                    },
                }),
            },
        };
    }

    beforeEach(() => {
        resetCaches();
        aplicarMocks();
    });

    afterEach(() => {
        resetCaches();
        mock.restoreAll();
    });

    async function tentar() {
        const { tentarLancarCaixaItemIngressoDinheiro } = await import(
            './ingressoPagamentoCaixaService'
        );
        return tentarLancarCaixaItemIngressoDinheiro({
            idTransacao: 99,
            idTransacaoPagamento: 42,
            valorTotal: 75.5,
        });
    }

    it('caixa já aberto → garante e lança CAIXA_ITEM (forma 38)', async () => {
        const id = await tentar();
        assert.equal(id, 5001);
        assert.equal(garantirCalls, 1);
        assert.equal(inseriCalls.length, 1);
        assert.equal(inseriCalls[0][0], '100');
        assert.equal(inseriCalls[0][1], 75.5);
        assert.equal(inseriCalls[0][2], 38);
        assert.equal(inseriCalls[0][3], 42);
    });

    it('garantir retorna idCaixa → inseri usa maior caixa (via mock)', async () => {
        garantirRetorno = 250;
        const id = await tentar();
        assert.equal(id, 5001);
        assert.equal(inseriCalls[0][0], '250');
    });

    it('falha ao garantir caixa → retorna null sem lançar', async () => {
        garantirErro = new Error('Firebird off');
        const id = await tentar();
        assert.equal(id, null);
        assert.equal(inseriCalls.length, 0);
    });

    it('falha no inseriCaixaItem → retorna null sem lançar', async () => {
        inseriErro = new Error('insert failed');
        const id = await tentar();
        assert.equal(id, null);
        assert.equal(garantirCalls, 1);
    });

    it('inseriCaixaItem retorna 0 → retorna null', async () => {
        inseriRetorno = 0;
        const id = await tentar();
        assert.equal(id, null);
    });
});
