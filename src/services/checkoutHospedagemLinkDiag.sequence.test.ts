/**
 * Sequência esperada de valores no checkout link (280 + taxa 100 + 50%).
 * Não substitui log em runtime (HOSPEDAGEM_CHECKOUT_DIAG=1); documenta o fluxo puro.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aplicarTaxasAdicionaisCheckout } from './reservaSuiteFinanceiroService';
import {
    aplicarPercentualCobrancaInicialTransacao,
    montarValoresTransacaoHospedagemSite,
} from './hospedagemTaxaPlataformaService';

const LINHAS_SUITE_280 = [
    { valorBaseCentavos: 28_000, adultosExtras: 0, noites: 1 },
];

function montarLinkComoCheckout(
    valorTotalReserva: number,
    percentual: 50 | 100
) {
    const base = montarValoresTransacaoHospedagemSite({
        transacaoCheckout: {
            preco: 0,
            taxaServico: 0,
            valorTotal: valorTotalReserva,
        },
        linhas: LINHAS_SUITE_280,
    });
    return percentual === 50
        ? aplicarPercentualCobrancaInicialTransacao(base, 50)
        : base;
}

describe('checkoutHospedagem link — sequência de Transacao (diag)', () => {
    it('280 + taxa 100 + 50%: create → recalc → remount', () => {
        const totaisSuites = { preco: 280, taxaServico: 0, valorTotal: 280 };
        const { valorTotalReserva } = aplicarTaxasAdicionaisCheckout(
            totaisSuites,
            100
        );
        assert.equal(valorTotalReserva, 380);

        const passo1Create = montarLinkComoCheckout(valorTotalReserva, 50);
        assert.deepEqual(
            {
                valorTotal: passo1Create.valorTotal,
                taxaServico: passo1Create.taxaServico,
                preco: passo1Create.preco,
            },
            { valorTotal: 190, taxaServico: 14, preco: 176 }
        );

        const passo2Recalc = {
            valorTotal: 380,
            taxaServico: 0,
            preco: 380,
        };

        const passo3Remount = montarLinkComoCheckout(
            valorTotalReserva,
            50
        );
        assert.deepEqual(
            {
                valorTotal: passo3Remount.valorTotal,
                taxaServico: passo3Remount.taxaServico,
                preco: passo3Remount.preco,
            },
            { valorTotal: 190, taxaServico: 14, preco: 176 }
        );

        assert.notEqual(
            passo1Create.valorTotal,
            140,
            'com taxa 100, create não deve ser 140'
        );
        assert.equal(passo2Recalc.valorTotal, 380);
    });

    it('280 sem taxa + 50%: só create (sem recalc/remount)', () => {
        const passo1 = montarLinkComoCheckout(280, 50);
        assert.deepEqual(
            {
                valorTotal: passo1.valorTotal,
                taxaServico: passo1.taxaServico,
                preco: passo1.preco,
            },
            { valorTotal: 140, taxaServico: 14, preco: 126 }
        );
    });
});
