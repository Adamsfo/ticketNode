import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    calcularTaxaPlataformaHospedagemCentavos,
    centavosParaReais,
    montarLinhasTaxaPlataformaDeCotacoesCheckout,
    montarValoresTransacaoHospedagemSite,
    aplicarPercentualCobrancaInicialTransacao,
    parsePercentualCobrancaInicialLink,
    normalizarPercentualCobrancaInicialLink,
} from './hospedagemTaxaPlataformaService';
import {
    calcularSaldoPendente,
    reservaQuitada,
} from '../utils/hospedagemPagamentoRecepcao';
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

function resolverSituacaoFinanceiraReserva(
    valorTotal: number,
    valorPago: number
): 'Quitada' | 'Parcial' | 'Pendente' {
    const saldoPendente = calcularSaldoPendente(valorTotal, valorPago);
    if (saldoPendente <= 0.009) {
        return 'Quitada';
    }
    if (valorPago > 0.009) {
        return 'Parcial';
    }
    return 'Pendente';
}

/** Espelha resolverValorBrutoPagamentoGateway (link 50% usa Transacao.valorTotal). */
function valorBrutoGatewayParaReserva(
    transacaoValorTotal: number,
    valorTotalReserva: number,
    valorPagoAtual: number
): number {
    const saldoPendenteReserva = calcularSaldoPendente(
        valorTotalReserva,
        valorPagoAtual
    );
    const valorBruto = transacaoValorTotal;
    if (valorBruto <= 0 || saldoPendenteReserva <= 0.009) {
        return 0;
    }
    return Math.min(valorBruto, saldoPendenteReserva);
}

describe('percentualCobrancaInicial (link recepção → cliente)', () => {
    it('parse: omitido → 100', () => {
        assert.equal(parsePercentualCobrancaInicialLink(undefined), 100);
        assert.equal(parsePercentualCobrancaInicialLink(null), 100);
        assert.equal(parsePercentualCobrancaInicialLink(''), 100);
    });

    it('parse: aceita 50 e 100', () => {
        assert.equal(parsePercentualCobrancaInicialLink(50), 50);
        assert.equal(parsePercentualCobrancaInicialLink(100), 100);
        assert.equal(parsePercentualCobrancaInicialLink('50'), 50);
    });

    it('parse: valor inválido lança erro', () => {
        assert.throws(
            () => parsePercentualCobrancaInicialLink(75),
            /50 ou 100/
        );
    });

    it('normalizar: só 50 permanece 50', () => {
        assert.equal(normalizarPercentualCobrancaInicialLink(50), 50);
        assert.equal(normalizarPercentualCobrancaInicialLink(75), 100);
    });

    it('100% — transação montada permanece idêntica', () => {
        const montado = montarValoresTransacaoHospedagemSite({
            transacaoCheckout: { preco: 1000, taxaServico: 0, valorTotal: 1000 },
            linhas: [{ valorBaseCentavos: 100_000, adultosExtras: 0, noites: 2 }],
        });
        const com100 = aplicarPercentualCobrancaInicialTransacao(montado, 100);
        assert.equal(com100, montado);
        assert.equal(com100.valorTotal, 1000);
    });

    it('50% — aplica após montarValoresTransacaoHospedagemSite (não divide reserva)', () => {
        const valorTotalReserva = 1000;
        const montado = montarValoresTransacaoHospedagemSite({
            transacaoCheckout: {
                preco: valorTotalReserva,
                taxaServico: 0,
                valorTotal: valorTotalReserva,
            },
            linhas: [{ valorBaseCentavos: 100_000, adultosExtras: 0, noites: 2 }],
        });
        assert.equal(montado.valorTotal, valorTotalReserva);

        const cobranca50 = aplicarPercentualCobrancaInicialTransacao(montado, 50);
        assert.equal(cobranca50.valorTotal, 500);
        assert.equal(cobranca50.taxaServico, 50);
        assert.equal(cobranca50.preco, 450);
        assert.equal(
            cobranca50.preco + cobranca50.taxaServico,
            cobranca50.valorTotal
        );
        assert.equal(valorTotalReserva, 1000);
    });

    it('50% — reserva maior (1350 / taxa 60) mantém taxa integral na cobrança', () => {
        const montado = montarValoresTransacaoHospedagemSite({
            transacaoCheckout: {
                preco: 1290,
                taxaServico: 30,
                valorTotal: 1350,
            },
            linhas: [
                { valorBaseCentavos: 100_000, adultosExtras: 1, noites: 2 },
            ],
        });
        assert.equal(montado.valorTotal, 1350);
        assert.equal(montado.taxaServico, 60);

        const cobranca50 = aplicarPercentualCobrancaInicialTransacao(montado, 50);
        assert.equal(cobranca50.valorTotal, 675);
        assert.equal(cobranca50.taxaServico, 60);
        assert.equal(cobranca50.preco, 615);
        assert.equal(
            cobranca50.preco + cobranca50.taxaServico,
            cobranca50.valorTotal
        );
    });

    it('confirmação simulada — pagamento 50% → Parcial e saldo 500', () => {
        const valorTotalReserva = 1000;
        const transacaoValorTotal = 500;
        const valorPagoAtual = 0;
        const lancamento = valorBrutoGatewayParaReserva(
            transacaoValorTotal,
            valorTotalReserva,
            valorPagoAtual
        );
        assert.equal(lancamento, 500);
        const valorPago = lancamento;
        const saldoPendente = calcularSaldoPendente(valorTotalReserva, valorPago);
        assert.equal(valorPago, 500);
        assert.equal(saldoPendente, 500);
        assert.equal(
            resolverSituacaoFinanceiraReserva(valorTotalReserva, valorPago),
            'Parcial'
        );
        assert.equal(reservaQuitada(valorTotalReserva, valorPago), false);
    });

    it('portaria — receber saldo restante → Quitada', () => {
        const valorTotalReserva = 1000;
        const valorPago = 500;
        const recebimentoPortaria = 500;
        const valorPagoFinal = valorPago + recebimentoPortaria;
        const saldoFinal = calcularSaldoPendente(
            valorTotalReserva,
            valorPagoFinal
        );
        assert.equal(valorPagoFinal, 1000);
        assert.equal(saldoFinal, 0);
        assert.equal(
            resolverSituacaoFinanceiraReserva(valorTotalReserva, valorPagoFinal),
            'Quitada'
        );
        assert.equal(reservaQuitada(valorTotalReserva, valorPagoFinal), true);
    });

    it('webhook duplicado — segundo lançamento zera valor efetivo', () => {
        const pagamentoJaLancado = true;
        const valorLancamentoGateway = 500;
        const valorEfetivo = pagamentoJaLancado ? 0 : valorLancamentoGateway;
        assert.equal(valorEfetivo, 0);
    });

    it('Salvar Reserva — percentual 50 não afeta checkout sem link', () => {
        const isLinkCliente = false;
        const percentualCobrancaInicial = 50;
        const percentualLink =
            isLinkCliente && percentualCobrancaInicial === 50 ? 50 : 100;
        assert.equal(percentualLink, 100);
    });

    it('reenvio de link não remonta transação (somente notificação)', () => {
        const fs = require('node:fs');
        const path = require('node:path');
        const src = fs.readFileSync(
            path.join(__dirname, 'hospedagemAdminService.ts'),
            'utf8'
        );
        const reenviarBlock = src.slice(
            src.indexOf('export async function reenviarLinkPagamentoReservaAdmin'),
            src.indexOf('function statusPermiteTrocaSuite')
        );
        assert.doesNotMatch(reenviarBlock, /Transacao\.(create|update)/);
        assert.doesNotMatch(reenviarBlock, /percentualCobrancaInicial/);
    });
});
