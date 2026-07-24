import { CustomError } from './customError';
import { roundMoney } from './reservaSuitePricing';
import type { FormaPagamentoRecepcao } from '../models/PagamentoHospedagem';

export const FORMAS_PAGAMENTO_RECEPCAO: FormaPagamentoRecepcao[] = [
    'PIX',
    'Dinheiro',
    'CartaoCredito',
    'CartaoDebito',
    'Transferencia',
    'Outro',
];

export const MSG_VALOR_PAGO_MAIOR =
    'O valor recebido não pode ser maior que o valor da reserva.';

export type PagamentoRecepcaoInput = {
    valor: number;
    formaPagamento: FormaPagamentoRecepcao;
    comprovante?: string | null;
    observacao?: string | null;
};

export function labelFormaPagamentoRecepcao(
    forma: FormaPagamentoRecepcao | string | null | undefined
): string {
    switch (forma) {
        case 'PIX':
            return 'PIX';
        case 'Dinheiro':
            return 'Dinheiro';
        case 'CartaoCredito':
            return 'Cartão Crédito';
        case 'CartaoDebito':
            return 'Cartão Débito';
        case 'Transferencia':
            return 'Transferência';
        case 'Outro':
            return 'Outro';
        default:
            return forma ? String(forma) : '—';
    }
}

export function calcularSaldoPendente(
    valorTotal: number,
    valorPago: number
): number {
    return roundMoney(Math.max(0, valorTotal - valorPago));
}

export function reservaQuitada(valorTotal: number, valorPago: number): boolean {
    return roundMoney(valorPago) >= roundMoney(valorTotal) - 0.009;
}

export function validarPagamentoRecepcao(
    valorTotal: number,
    pagamento: PagamentoRecepcaoInput | null | undefined
): void {
    if (!pagamento) {
        return;
    }

    const valor = roundMoney(Number(pagamento.valor));
    if (Number.isNaN(valor) || valor < 0) {
        throw new CustomError('Valor pago inválido.', 400, '');
    }

    if (valor > roundMoney(valorTotal) + 0.009) {
        throw new CustomError(MSG_VALOR_PAGO_MAIOR, 400, '');
    }

    if (
        valor > 0 &&
        !FORMAS_PAGAMENTO_RECEPCAO.includes(pagamento.formaPagamento)
    ) {
        throw new CustomError('Forma de pagamento inválida.', 400, '');
    }
}

export function parsePagamentoRecepcao(
    raw: unknown
): PagamentoRecepcaoInput | null {
    if (raw === undefined || raw === null) {
        return null;
    }

    const body = raw as {
        valor?: unknown;
        formaPagamento?: unknown;
        comprovante?: unknown;
        observacao?: unknown;
    };

    const valor = roundMoney(Number(body.valor ?? 0));
    if (Number.isNaN(valor) || valor < 0) {
        throw new CustomError('Valor pago inválido.', 400, '');
    }

    if (valor === 0) {
        return {
            valor: 0,
            formaPagamento: 'Dinheiro',
            comprovante: null,
            observacao: body.observacao
                ? String(body.observacao).trim() || null
                : null,
        };
    }

    const forma = String(body.formaPagamento ?? '').trim() as FormaPagamentoRecepcao;
    if (!FORMAS_PAGAMENTO_RECEPCAO.includes(forma)) {
        throw new CustomError(
            'Informe a forma de pagamento do valor recebido.',
            400,
            ''
        );
    }

    return {
        valor,
        formaPagamento: forma,
        comprovante: body.comprovante
            ? String(body.comprovante).trim() || null
            : null,
        observacao: body.observacao
            ? String(body.observacao).trim() || null
            : null,
    };
}

export function formatarMoedaHistorico(valor: number): string {
    return `R$ ${roundMoney(valor).toFixed(2).replace('.', ',')}`;
}
