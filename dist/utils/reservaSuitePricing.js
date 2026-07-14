"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VALOR_ADICIONAL_CRIANCA_EXTRA = exports.VALOR_ADICIONAL_ADULTO_EXTRA = void 0;
exports.toNumber = toNumber;
exports.roundMoney = roundMoney;
exports.inicioDoDia = inicioDoDia;
exports.calcularNoitesHotelaria = calcularNoitesHotelaria;
exports.calcularExtrasOcupacao = calcularExtrasOcupacao;
exports.obterValoresExtrasSuite = obterValoresExtrasSuite;
exports.calcularTotaisSuitePousada = calcularTotaisSuitePousada;
exports.calcularSubtotalSuitePousada = calcularSubtotalSuitePousada;
exports.VALOR_ADICIONAL_ADULTO_EXTRA = 150;
exports.VALOR_ADICIONAL_CRIANCA_EXTRA = 120;
function toNumber(value) {
    return Number(value ?? 0);
}
function roundMoney(value) {
    return Math.round(value * 100) / 100;
}
function inicioDoDia(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}
function calcularNoitesHotelaria(checkin, checkout) {
    const inicio = inicioDoDia(checkin);
    const fim = inicioDoDia(checkout);
    const diffMs = fim.getTime() - inicio.getTime();
    return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}
function calcularExtrasOcupacao(adultos, criancas, qtdeMinimaPessoas, qtdeMaximaPessoas) {
    const total = adultos + criancas;
    const min = qtdeMinimaPessoas ?? 1;
    const max = qtdeMaximaPessoas ?? min;
    if (total > max || total < min) {
        return null;
    }
    const adultosIncluidos = Math.min(adultos, min);
    const criancasIncluidas = Math.min(criancas, min - adultosIncluidos);
    const adultosExtras = adultos - adultosIncluidos;
    const criancasExtras = criancas - criancasIncluidas;
    return {
        min,
        max,
        total,
        adultosIncluidos,
        criancasIncluidas,
        adultosExtras,
        criancasExtras,
    };
}
function obterValoresExtrasSuite(suite) {
    return {
        valorAdultoExtra: toNumber(suite.valorAdultoExtra ?? exports.VALOR_ADICIONAL_ADULTO_EXTRA),
        valorCriancaExtra: toNumber(suite.valorCriancaExtra ?? exports.VALOR_ADICIONAL_CRIANCA_EXTRA),
    };
}
function calcularTotaisSuitePousada(suite, adultos, criancas, noites) {
    const extras = calcularExtrasOcupacao(adultos, criancas, suite.qtdeMinimaPessoas, suite.qtdeMaximaPessoas);
    if (!extras || noites < 1) {
        return null;
    }
    const { valorAdultoExtra, valorCriancaExtra } = obterValoresExtrasSuite(suite);
    const precoDiaria = toNumber(suite.preco);
    const taxaDiaria = toNumber(suite.taxaServico);
    const valorDiaria = toNumber(suite.valor);
    const suitePreco = roundMoney(precoDiaria * noites);
    const suiteTaxa = roundMoney(taxaDiaria * noites);
    const suiteValor = roundMoney(valorDiaria * noites);
    const extraAdultoValor = roundMoney(extras.adultosExtras * valorAdultoExtra * noites);
    const extraCriancaValor = roundMoney(extras.criancasExtras * valorCriancaExtra * noites);
    const precoTotal = roundMoney(suitePreco + extraAdultoValor + extraCriancaValor);
    const taxaServicoTotal = suiteTaxa;
    const valorTotal = roundMoney(precoTotal + taxaServicoTotal);
    return {
        ...extras,
        valorAdultoExtra,
        valorCriancaExtra,
        precoDiaria,
        taxaDiaria,
        valorDiaria,
        suitePreco,
        suiteTaxa,
        suiteValor,
        extraAdultoValor,
        extraCriancaValor,
        precoTotal,
        taxaServicoTotal,
        valorTotal,
        temExtras: extras.adultosExtras > 0 || extras.criancasExtras > 0,
    };
}
function calcularSubtotalSuitePousada(suite, adultos, criancas, noites) {
    const totais = calcularTotaisSuitePousada(suite, adultos, criancas, noites);
    if (!totais) {
        return null;
    }
    return {
        suitePreco: totais.suitePreco,
        adultosExtras: totais.adultosExtras,
        criancasExtras: totais.criancasExtras,
        extraAdultoValor: totais.extraAdultoValor,
        extraCriancaValor: totais.extraCriancaValor,
        valorTotal: totais.valorTotal,
        temExtras: totais.temExtras,
    };
}
