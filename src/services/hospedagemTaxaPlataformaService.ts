import { roundMoney } from '../utils/reservaSuitePricing';

export const TAXA_PLATAFORMA_PERCENTUAL_BASE = 0.05;
export const TAXA_PLATAFORMA_ADULTO_EXTRA_POR_NOITE_CENTAVOS = 500;

export type LinhaTaxaPlataformaHospedagem = {
    valorBaseCentavos: number;
    adultosExtras: number;
    noites: number;
};

export type ResultadoTaxaPlataformaCentavos = {
    valorBaseTotalCentavos: number;
    taxaBaseCentavos: number;
    taxaAdultosCentavos: number;
    taxaPlataformaCentavos: number;
};

export function reaisParaCentavos(valor: number): number {
    return Math.round(roundMoney(valor) * 100);
}

export function centavosParaReais(centavos: number): number {
    return roundMoney(centavos / 100);
}

/**
 * Taxa da plataforma (split MP): 5% sobre diária base + R$ 5/adulto extra/noite.
 * Não inclui taxa da suíte, extras de ocupação (valor), taxas manuais, etc.
 */
export function calcularTaxaPlataformaHospedagemCentavos(
    linhas: LinhaTaxaPlataformaHospedagem[]
): ResultadoTaxaPlataformaCentavos {
    let valorBaseTotalCentavos = 0;
    let taxaAdultosCentavos = 0;

    for (const linha of linhas) {
        const adultosExtras = Math.max(0, Math.floor(linha.adultosExtras));
        const noites = Math.max(0, Math.floor(linha.noites));
        const valorBaseCentavos = Math.max(0, Math.floor(linha.valorBaseCentavos));

        valorBaseTotalCentavos += valorBaseCentavos;
        taxaAdultosCentavos +=
            adultosExtras * noites * TAXA_PLATAFORMA_ADULTO_EXTRA_POR_NOITE_CENTAVOS;
    }

    const taxaBaseCentavos = Math.round(
        valorBaseTotalCentavos * TAXA_PLATAFORMA_PERCENTUAL_BASE
    );
    const taxaPlataformaCentavos = taxaBaseCentavos + taxaAdultosCentavos;

    return {
        valorBaseTotalCentavos,
        taxaBaseCentavos,
        taxaAdultosCentavos,
        taxaPlataformaCentavos,
    };
}

export type ValoresTransacaoCheckoutHospedagem = {
    preco: number;
    taxaServico: number;
    valorTotal: number;
};

/**
 * Monta os valores da Transacao para checkout online (site).
 * valorTotal permanece o total original; taxaServico = somente taxa da plataforma.
 */
export function montarValoresTransacaoHospedagemSite(params: {
    transacaoCheckout: ValoresTransacaoCheckoutHospedagem;
    linhas: LinhaTaxaPlataformaHospedagem[];
}): ValoresTransacaoCheckoutHospedagem {
    const valorTotalOriginal = roundMoney(params.transacaoCheckout.valorTotal);
    const detalhes = calcularTaxaPlataformaHospedagemCentavos(params.linhas);
    let taxaPlataforma = centavosParaReais(detalhes.taxaPlataformaCentavos);

    if (taxaPlataforma < 0) {
        taxaPlataforma = 0;
    }
    if (taxaPlataforma >= valorTotalOriginal && valorTotalOriginal > 0) {
        taxaPlataforma = roundMoney(Math.max(0, valorTotalOriginal - 0.01));
    }

    const preco = roundMoney(valorTotalOriginal - taxaPlataforma);

    return {
        preco,
        taxaServico: taxaPlataforma,
        valorTotal: valorTotalOriginal,
    };
}

export function montarLinhasTaxaPlataformaDeCotacoesCheckout(
    suitesComTotais: Array<{
        cotacao: {
            noites: number;
            suite: { totais: { preco: number } };
            adicionais: { adultos: { qtde: number } };
        };
    }>
): LinhaTaxaPlataformaHospedagem[] {
    return suitesComTotais.map(({ cotacao }) => ({
        valorBaseCentavos: reaisParaCentavos(cotacao.suite.totais.preco),
        adultosExtras: Math.max(0, Math.floor(cotacao.adicionais.adultos.qtde)),
        noites: Math.max(0, Math.floor(cotacao.noites)),
    }));
}
