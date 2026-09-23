import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    calcularTaxaPlataformaHospedagemCentavos,
    centavosParaReais,
    montarLinhasTaxaPlataformaDeCotacoesCheckout,
    montarValoresTransacaoHospedagemSite,
} from './hospedagemTaxaPlataformaService';
import {
    calcularTotaisSuitePousada,
    VALOR_ADICIONAL_ADULTO_EXTRA,
} from '../utils/reservaSuitePricing';
import { aplicarTaxasAdicionaisCheckout } from './reservaSuiteFinanceiroService';

describe('calcularTaxaPlataformaHospedagemCentavos', () => {
    it('base R$ 1.000, 0 adultos, 2 noites', () => {
        const r = calcularTaxaPlataformaHospedagemCentavos([
            { valorBaseCentavos: 100_000, adultosExtras: 0, noites: 2 },
        ]);
        assert.equal(r.taxaBaseCentavos, 5000);
        assert.equal(r.taxaAdultosCentavos, 0);
        assert.equal(centavosParaReais(r.taxaPlataformaCentavos), 50);
    });

    it('base R$ 1.000, 1 adulto, 2 noites', () => {
        const r = calcularTaxaPlataformaHospedagemCentavos([
            { valorBaseCentavos: 100_000, adultosExtras: 1, noites: 2 },
        ]);
        assert.equal(centavosParaReais(r.taxaPlataformaCentavos), 60);
    });

    it('base R$ 1.000, 2 adultos, 2 noites', () => {
        const r = calcularTaxaPlataformaHospedagemCentavos([
            { valorBaseCentavos: 100_000, adultosExtras: 2, noites: 2 },
        ]);
        assert.equal(centavosParaReais(r.taxaPlataformaCentavos), 70);
    });

    it('base R$ 2.000, 1 adulto, 4 noites', () => {
        const r = calcularTaxaPlataformaHospedagemCentavos([
            { valorBaseCentavos: 200_000, adultosExtras: 1, noites: 4 },
        ]);
        assert.equal(centavosParaReais(r.taxaPlataformaCentavos), 120);
    });

    it('multi-suite por linha', () => {
        const r = calcularTaxaPlataformaHospedagemCentavos([
            { valorBaseCentavos: 50_000, adultosExtras: 1, noites: 2 },
            { valorBaseCentavos: 30_000, adultosExtras: 2, noites: 3 },
        ]);
        assert.equal(r.taxaBaseCentavos, 4000);
        assert.equal(r.taxaAdultosCentavos, 1000 + 3000);
        assert.equal(centavosParaReais(r.taxaPlataformaCentavos), 80);
    });
});

describe('montarValoresTransacaoHospedagemSite', () => {
    it('mantém valorTotal original e reparte preco/taxaServico', () => {
        const checkout = { preco: 1320, taxaServico: 30, valorTotal: 1350 };
        const montado = montarValoresTransacaoHospedagemSite({
            transacaoCheckout: checkout,
            linhas: [
                { valorBaseCentavos: 100_000, adultosExtras: 1, noites: 2 },
            ],
        });

        assert.equal(montado.valorTotal, 1350);
        assert.equal(montado.taxaServico, 60);
        assert.equal(montado.preco, 1290);
        assert.equal(montado.preco + montado.taxaServico, montado.valorTotal);
        assert.equal(checkout.preco, 1320);
        assert.equal(checkout.taxaServico, 30);
    });

    it('application_fee seria somente taxaServico da transacao montada', () => {
        const montado = montarValoresTransacaoHospedagemSite({
            transacaoCheckout: { preco: 1000, taxaServico: 0, valorTotal: 1000 },
            linhas: [{ valorBaseCentavos: 100_000, adultosExtras: 0, noites: 2 }],
        });
        const applicationFee = montado.taxaServico;
        assert.equal(applicationFee, 50);
        assert.equal(montado.valorTotal, 1000);
    });
});

describe('link externo (isLinkCliente) — preparação da Transacao', () => {
    const suitesComTotaisLink = [
        {
            cotacao: {
                noites: 2,
                suite: { totais: { preco: 1000 } },
                adicionais: { adultos: { qtde: 1 } },
            },
        },
    ];

    it('reparte Transacao como no site (taxa plataforma, não taxa da suíte)', () => {
        const totaisSuites = { preco: 1320, taxaServico: 30, valorTotal: 1350 };
        const { transacao: transacaoCheckout } = aplicarTaxasAdicionaisCheckout(
            totaisSuites,
            0
        );

        assert.equal(transacaoCheckout.taxaServico, 30);

        const montado = montarValoresTransacaoHospedagemSite({
            transacaoCheckout,
            linhas: montarLinhasTaxaPlataformaDeCotacoesCheckout(
                suitesComTotaisLink
            ),
        });

        assert.equal(montado.valorTotal, 1350);
        assert.equal(montado.taxaServico, 60);
        assert.equal(montado.preco, 1290);
        assert.equal(montado.preco + montado.taxaServico, montado.valorTotal);
    });

    it('após taxas adicionais da recepção, usa valorTotal final e taxa plataforma', () => {
        const totaisSuites = { preco: 1320, taxaServico: 30, valorTotal: 1350 };
        const { transacao: aposRecalculoServicos } =
            aplicarTaxasAdicionaisCheckout(totaisSuites, 150);

        assert.equal(aposRecalculoServicos.valorTotal, 1500);
        assert.equal(aposRecalculoServicos.taxaServico, 30);

        const montado = montarValoresTransacaoHospedagemSite({
            transacaoCheckout: aposRecalculoServicos,
            linhas: montarLinhasTaxaPlataformaDeCotacoesCheckout(
                suitesComTotaisLink
            ),
        });

        assert.equal(montado.valorTotal, 1500);
        assert.equal(montado.taxaServico, 60);
        assert.equal(montado.preco, 1440);
    });
});

describe('montarLinhasTaxaPlataformaDeCotacoesCheckout', () => {
    it('usa suite.totais.preco como base e qtde de adultos extras', () => {
        const linhas = montarLinhasTaxaPlataformaDeCotacoesCheckout([
            {
                cotacao: {
                    noites: 2,
                    suite: { totais: { preco: 1000 } },
                    adicionais: { adultos: { qtde: 1 } },
                },
            },
        ]);
        assert.deepEqual(linhas, [
            { valorBaseCentavos: 100_000, adultosExtras: 1, noites: 2 },
        ]);
    });
});

describe('adulto adicional comercial R$ 160', () => {
    const suite = {
        preco: 500,
        taxaServico: 0,
        valor: 500,
        qtdeMinimaPessoas: 2,
        qtdeMaximaPessoas: 6,
    };

    it('constante 160', () => {
        assert.equal(VALOR_ADICIONAL_ADULTO_EXTRA, 160);
    });

    it('1 adulto extra × 2 noites = 320', () => {
        const t = calcularTotaisSuitePousada(suite, 3, 0, 2);
        assert.ok(t);
        assert.equal(t.extraAdultoValor, 320);
        assert.equal(t.suitePreco, 1000);
    });
});
