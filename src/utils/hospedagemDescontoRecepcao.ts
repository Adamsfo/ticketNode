import { CustomError } from './customError';
import { roundMoney } from './reservaSuitePricing';

export type DescontoRecepcaoTipo = 'PERCENTUAL' | 'VALOR';

export type DescontoRecepcaoInput = {
    tipo: DescontoRecepcaoTipo;
    valor: number;
};

/** Limite operacional sugerido para desconto percentual manual. */
export const DESCONTO_MAX_PERCENTUAL_RECEPCAO = 30;

export const MSG_DESCONTO_INVALIDO = 'O desconto informado é inválido.';

export function calcularValorDesconto(
    valorOriginal: number,
    desconto: DescontoRecepcaoInput
): number {
    if (desconto.tipo === 'PERCENTUAL') {
        return roundMoney((valorOriginal * desconto.valor) / 100);
    }
    return roundMoney(desconto.valor);
}

export function calcularValorFinalComDesconto(
    valorOriginal: number,
    desconto: DescontoRecepcaoInput
): number {
    const valorDesconto = calcularValorDesconto(valorOriginal, desconto);
    return roundMoney(Math.max(0, valorOriginal - valorDesconto));
}

export function descontoRecepcaoValido(
    valorOriginal: number,
    desconto: DescontoRecepcaoInput | null | undefined
): boolean {
    if (!desconto || desconto.valor <= 0) {
        return true;
    }

    if (valorOriginal <= 0) {
        return false;
    }

    if (desconto.tipo === 'PERCENTUAL') {
        if (
            desconto.valor > 100 ||
            desconto.valor > DESCONTO_MAX_PERCENTUAL_RECEPCAO
        ) {
            return false;
        }
        const valorDesconto = calcularValorDesconto(valorOriginal, desconto);
        return valorDesconto > 0 && valorDesconto < valorOriginal;
    }

    return desconto.valor > 0 && desconto.valor < valorOriginal;
}

export function validarDescontoRecepcao(
    valorOriginal: number,
    desconto: DescontoRecepcaoInput | null | undefined
): void {
    if (!desconto || desconto.valor <= 0) {
        return;
    }

    if (!descontoRecepcaoValido(valorOriginal, desconto)) {
        throw new CustomError(MSG_DESCONTO_INVALIDO, 400, '');
    }
}

/** Reparte valor final proporcionalmente entre preço e taxa. */
export function aplicarDescontoProporcional(
    preco: number,
    taxaServico: number,
    valorFinal: number
): { preco: number; taxaServico: number; valorTotal: number } {
    const valorOriginal = roundMoney(preco + taxaServico);
    if (valorOriginal <= 0) {
        return { preco: 0, taxaServico: 0, valorTotal: 0 };
    }

    if (valorFinal >= valorOriginal) {
        return {
            preco: roundMoney(preco),
            taxaServico: roundMoney(taxaServico),
            valorTotal: valorOriginal,
        };
    }

    const ratio = valorFinal / valorOriginal;
    const precoFinal = roundMoney(preco * ratio);
    const taxaFinal = roundMoney(valorFinal - precoFinal);

    return {
        preco: precoFinal,
        taxaServico: taxaFinal,
        valorTotal: roundMoney(valorFinal),
    };
}

export function formatarDescontoHistorico(
    desconto: DescontoRecepcaoInput
): string {
    if (desconto.tipo === 'PERCENTUAL') {
        return `${desconto.valor}%`;
    }
    return `R$ ${desconto.valor.toFixed(2).replace('.', ',')}`;
}

export function parseDescontoRecepcao(
    raw: unknown,
    index: number
): DescontoRecepcaoInput | null {
    if (raw === undefined || raw === null) {
        return null;
    }

    const tipo = String((raw as { tipo?: string }).tipo ?? '')
        .trim()
        .toUpperCase();
    const valor = Number((raw as { valor?: unknown }).valor);

    if (!tipo && (Number.isNaN(valor) || valor <= 0)) {
        return null;
    }

    if (tipo !== 'PERCENTUAL' && tipo !== 'VALOR') {
        throw new CustomError(
            `suites[${index}].desconto.tipo deve ser PERCENTUAL ou VALOR.`,
            400,
            ''
        );
    }

    if (Number.isNaN(valor) || valor <= 0) {
        throw new CustomError(
            `suites[${index}].desconto.valor deve ser maior que zero.`,
            400,
            ''
        );
    }

    return { tipo: tipo as DescontoRecepcaoTipo, valor: roundMoney(valor) };
}
