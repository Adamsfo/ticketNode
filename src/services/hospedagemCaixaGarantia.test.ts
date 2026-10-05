/**
 * node --require ts-node/register/transpile-only --test \
 *   src/utils/caixaPdvAberto.test.ts \
 *   src/services/hospedagemCaixaGarantia.test.ts \
 *   src/services/hospedagemPagamentoCaixa.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import type { CaixaResumoPdv } from '../api/apiJango';
import {
    __resetLockAberturaCaixaHospedagemParaTestes,
    garantirCaixaAbertoHospedagemComDeps,
    type GarantiaCaixaHospedagemDeps,
} from './hospedagemCaixaGarantia';

function caixa(id: number, fechamento: Date | string | null = null): CaixaResumoPdv {
    return {
        idCaixa: id,
        dataAbertura: new Date(),
        dataFechamento: fechamento,
        status: null,
        totalVendido: 0,
        totalRecebido: 0,
    };
}

describe('garantirCaixaAbertoHospedagemComDeps', () => {
    afterEach(() => {
        __resetLockAberturaCaixaHospedagemParaTestes();
    });

    it('cenário 1: caixa aberto existe → não abre outro', async () => {
        let aberturas = 0;
        const deps: GarantiaCaixaHospedagemDeps = {
            getCaixaAbertoDoDia: async () => caixa(100),
            listCaixasAbertosDoDia: async () => [caixa(100)],
            inseriCaixaItemAbertura: async () => {
                aberturas += 1;
                return 1;
            },
            aguardarMs: async () => undefined,
        };

        const id = await garantirCaixaAbertoHospedagemComDeps(deps, {
            formaPagamento: 'Dinheiro',
        });
        assert.equal(id, 100);
        assert.equal(aberturas, 0);
    });

    it('cenário 2: não existe caixa hoje → abre automaticamente', async () => {
        let aberturas = 0;
        const deps: GarantiaCaixaHospedagemDeps = {
            getCaixaAbertoDoDia: async () => {
                if (aberturas > 0) {
                    return caixa(201);
                }
                return null;
            },
            listCaixasAbertosDoDia: async () =>
                aberturas > 0 ? [caixa(201)] : [],
            inseriCaixaItemAbertura: async () => {
                aberturas += 1;
                return 9001;
            },
            aguardarMs: async () => undefined,
        };

        const id = await garantirCaixaAbertoHospedagemComDeps(deps);
        assert.equal(id, 201);
        assert.equal(aberturas, 1);
    });

    it('cenário 3: só caixa fechado hoje → getCaixaAbertoDoDia null → abre novo', async () => {
        let aberturas = 0;
        const deps: GarantiaCaixaHospedagemDeps = {
            getCaixaAbertoDoDia: async () => {
                if (aberturas > 0) {
                    return caixa(302);
                }
                return null;
            },
            listCaixasAbertosDoDia: async () =>
                aberturas > 0 ? [caixa(302)] : [],
            inseriCaixaItemAbertura: async () => {
                aberturas += 1;
                return 1;
            },
            aguardarMs: async () => undefined,
        };

        const id = await garantirCaixaAbertoHospedagemComDeps(deps);
        assert.equal(id, 302);
        assert.equal(aberturas, 1);
    });

    it('cenário 4: falha na abertura → erro propagado', async () => {
        const deps: GarantiaCaixaHospedagemDeps = {
            getCaixaAbertoDoDia: async () => null,
            listCaixasAbertosDoDia: async () => [],
            inseriCaixaItemAbertura: async () => {
                throw new Error('Firebird indisponível');
            },
            aguardarMs: async () => undefined,
        };

        await assert.rejects(
            () => garantirCaixaAbertoHospedagemComDeps(deps),
            /Firebird indisponível/
        );
    });

    it('cenário 5: duas chamadas simultâneas → uma abertura', async () => {
        let aberturas = 0;
        let caixaDisponivel: CaixaResumoPdv | null = null;

        const deps: GarantiaCaixaHospedagemDeps = {
            getCaixaAbertoDoDia: async () => caixaDisponivel,
            listCaixasAbertosDoDia: async () =>
                caixaDisponivel ? [caixaDisponivel] : [],
            inseriCaixaItemAbertura: async () => {
                aberturas += 1;
                await new Promise((r) => setTimeout(r, 30));
                caixaDisponivel = caixa(501);
                return 1;
            },
            aguardarMs: async () => undefined,
        };

        const [a, b] = await Promise.all([
            garantirCaixaAbertoHospedagemComDeps(deps),
            garantirCaixaAbertoHospedagemComDeps(deps),
        ]);
        assert.equal(a, 501);
        assert.equal(b, 501);
        assert.equal(aberturas, 1);
    });
});
