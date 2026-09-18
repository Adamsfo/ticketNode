import { differenceInMilliseconds } from 'date-fns';
import {
    ReservaHospedagem,
    StatusReservaHospedagem,
} from '../models/ReservaHospedagem';
import {
    FormaPagamentoRecepcaoValor,
    type FormaPagamentoRecepcao,
} from '../models/PagamentoHospedagem';
import { SUITE_DISPONIBILIDADE_TZ } from './suiteDisponibilidadeService';

const MS_POR_HORA = 60 * 60 * 1000;
const HORAS_LIMITE_DEVOLUCAO_INTEGRAL = 72;

/** Origens externas / operacionais que o cliente não pode cancelar. */
const ORIGENS_RESERVA_BLOQUEADAS_CLIENTE = new Set([
    'HOSPEDIN',
    'BOOKING',
    'AIRBNB',
    'EXPEDIA',
    'JANGO',
    'TELEFONE',
    'BALCAO',
    'BALCÃO',
]);

/** Checkout online do cliente (produção + legado). */
const ORIGENS_RESERVA_SITE_CLIENTE = new Set(['CLIENTE', 'SITE']);

export type PagamentoHospedagemResumo = {
    id: number;
    valor: number;
    formaPagamento: FormaPagamentoRecepcao | string;
    comprovante?: string | null;
};

export type PoliticaDevolucaoCliente = {
    horasRestantes: number;
    percentualDevolucao: 50 | 100;
    valorPago: number;
    valorDevolucao: number;
};

export type ElegibilidadeCancelamentoCliente = {
    podeCancelar: boolean;
    motivoBloqueio: string | null;
    percentualDevolucao: 50 | 100 | null;
    valorDevolucao: number | null;
    valorPagoMercadoPago: number;
    valorDevolucaoMercadoPago: number;
    requerEstornoManual: boolean;
};

function toNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

export function normalizarOrigemReserva(
    origemReserva: string | null | undefined
): string {
    return String(origemReserva ?? '')
        .trim()
        .toUpperCase();
}

/**
 * Origens elegíveis para cancelamento pelo cliente:
 * - CLIENTE / SITE (checkout online)
 * - LINK_CLIENTE (quando persistido)
 * - ATENDENTE com tokenPagamento (link externo de pagamento)
 */
export function isOrigemCancelamentoClientePermitida(reserva: {
    origemReserva?: string | null;
    tokenPagamento?: string | null;
}): boolean {
    const origem = normalizarOrigemReserva(reserva.origemReserva);

    if (ORIGENS_RESERVA_BLOQUEADAS_CLIENTE.has(origem)) {
        return false;
    }

    if (origem === 'HOSPEDIN') {
        return false;
    }

    if (ORIGENS_RESERVA_SITE_CLIENTE.has(origem) || origem === 'LINK_CLIENTE') {
        return true;
    }

    if (!origem) {
        return true;
    }

    if (Boolean(String(reserva.tokenPagamento ?? '').trim())) {
        return true;
    }

    if (origem === 'ATENDENTE') {
        return false;
    }

    return false;
}

export function calcularHorasRestantesCheckin(
    checkin: Date | string,
    agora: Date = new Date()
): number {
    const inicio = new Date(checkin);
    const diffMs = differenceInMilliseconds(inicio, agora);
    return diffMs / MS_POR_HORA;
}

export function calcularPoliticaDevolucaoCliente(params: {
    checkin: Date | string;
    valorPago: number;
    agora?: Date;
}): PoliticaDevolucaoCliente {
    const valorPago = roundMoney(toNumber(params.valorPago));
    const horasRestantes = calcularHorasRestantesCheckin(
        params.checkin,
        params.agora ?? new Date()
    );
    const percentualDevolucao: 50 | 100 =
        horasRestantes > HORAS_LIMITE_DEVOLUCAO_INTEGRAL ? 100 : 50;
    const valorDevolucao = roundMoney(
        (valorPago * percentualDevolucao) / 100
    );

    return {
        horasRestantes,
        percentualDevolucao,
        valorPago,
        valorDevolucao,
    };
}

export function isComprovanteMercadoPago(comprovante: unknown): boolean {
    const texto = String(comprovante ?? '').trim();
    return /^\d{8,}$/.test(texto);
}

export function isFormaPagamentoMercadoPago(
    forma: FormaPagamentoRecepcao | string | null | undefined
): boolean {
    const valor = String(forma ?? '').trim();
    return (
        valor === FormaPagamentoRecepcaoValor.LinkPagamento ||
        valor === FormaPagamentoRecepcaoValor.PIX ||
        valor === FormaPagamentoRecepcaoValor.CartaoCredito ||
        valor === FormaPagamentoRecepcaoValor.CartaoDebito
    );
}

export function classificarPagamentoMercadoPago(
    pagamento: PagamentoHospedagemResumo
): boolean {
    const comprovante = String(pagamento.comprovante ?? '').trim();
    if (!comprovante) {
        return false;
    }

    if (
        pagamento.formaPagamento === FormaPagamentoRecepcaoValor.Dinheiro ||
        pagamento.formaPagamento === FormaPagamentoRecepcaoValor.Antecipado ||
        pagamento.formaPagamento === FormaPagamentoRecepcaoValor.RecebidoOta ||
        pagamento.formaPagamento === FormaPagamentoRecepcaoValor.Transferencia
    ) {
        return false;
    }

    if (comprovante.startsWith('tef:') || comprovante.startsWith('transacao:')) {
        return false;
    }

    if (isFormaPagamentoMercadoPago(pagamento.formaPagamento)) {
        return isComprovanteMercadoPago(comprovante);
    }

    return isComprovanteMercadoPago(comprovante);
}

export function somarValorPagoMercadoPago(
    pagamentos: PagamentoHospedagemResumo[]
): number {
    return roundMoney(
        pagamentos
            .filter(classificarPagamentoMercadoPago)
            .reduce((acc, item) => acc + toNumber(item.valor), 0)
    );
}

export function avaliarElegibilidadeCancelamentoCliente(params: {
    reserva: Pick<
        ReservaHospedagem,
        | 'status'
        | 'origemReserva'
        | 'tokenPagamento'
        | 'checkin'
        | 'valorPago'
    >;
    pagamentos: PagamentoHospedagemResumo[];
    agora?: Date;
}): ElegibilidadeCancelamentoCliente {
    const status = String(params.reserva.status);
    const valorPago = roundMoney(toNumber(params.reserva.valorPago ?? 0));
    const valorPagoMercadoPago = somarValorPagoMercadoPago(params.pagamentos);

    if (status === StatusReservaHospedagem.Cancelada) {
        return {
            podeCancelar: false,
            motivoBloqueio: 'Esta reserva já está cancelada.',
            percentualDevolucao: null,
            valorDevolucao: null,
            valorPagoMercadoPago,
            valorDevolucaoMercadoPago: 0,
            requerEstornoManual: false,
        };
    }

    if (status !== StatusReservaHospedagem.Confirmada) {
        return {
            podeCancelar: false,
            motivoBloqueio: 'Somente reservas confirmadas podem ser canceladas.',
            percentualDevolucao: null,
            valorDevolucao: null,
            valorPagoMercadoPago,
            valorDevolucaoMercadoPago: 0,
            requerEstornoManual: false,
        };
    }

    if (!isOrigemCancelamentoClientePermitida(params.reserva)) {
        return {
            podeCancelar: false,
            motivoBloqueio:
                'Esta reserva não pode ser cancelada pelo cliente neste canal.',
            percentualDevolucao: null,
            valorDevolucao: null,
            valorPagoMercadoPago,
            valorDevolucaoMercadoPago: 0,
            requerEstornoManual: false,
        };
    }

    const politica = calcularPoliticaDevolucaoCliente({
        checkin: params.reserva.checkin,
        valorPago,
        agora: params.agora,
    });
    const valorDevolucaoMercadoPago = roundMoney(
        Math.min(politica.valorDevolucao, valorPagoMercadoPago)
    );
    const requerEstornoManual =
        politica.valorDevolucao > valorDevolucaoMercadoPago + 0.009;

    if (politica.valorDevolucao > 0.009 && valorPagoMercadoPago <= 0.009) {
        return {
            podeCancelar: false,
            motivoBloqueio:
                'Esta reserva possui pagamentos que não podem ser estornados automaticamente. Entre em contato com a pousada.',
            percentualDevolucao: politica.percentualDevolucao,
            valorDevolucao: politica.valorDevolucao,
            valorPagoMercadoPago,
            valorDevolucaoMercadoPago: 0,
            requerEstornoManual: true,
        };
    }

    if (requerEstornoManual) {
        return {
            podeCancelar: false,
            motivoBloqueio:
                'Parte do valor pago não é elegível para estorno automático. Entre em contato com a pousada.',
            percentualDevolucao: politica.percentualDevolucao,
            valorDevolucao: politica.valorDevolucao,
            valorPagoMercadoPago,
            valorDevolucaoMercadoPago,
            requerEstornoManual: true,
        };
    }

    return {
        podeCancelar: true,
        motivoBloqueio: null,
        percentualDevolucao: politica.percentualDevolucao,
        valorDevolucao: politica.valorDevolucao,
        valorPagoMercadoPago,
        valorDevolucaoMercadoPago,
        requerEstornoManual: false,
    };
}

export function distribuirEstornoMercadoPago(
    pagamentos: PagamentoHospedagemResumo[],
    valorEstornoTotal: number
): Array<{ idPagamentoHospedagem: number; paymentId: string; amount: number }> {
    const valorAlvo = roundMoney(valorEstornoTotal);
    if (valorAlvo <= 0) {
        return [];
    }

    let restante = valorAlvo;
    const elegiveis = pagamentos
        .filter(classificarPagamentoMercadoPago)
        .sort((a, b) => a.id - b.id);

    const distribuicao: Array<{
        idPagamentoHospedagem: number;
        paymentId: string;
        amount: number;
    }> = [];

    for (const pagamento of elegiveis) {
        if (restante <= 0) {
            break;
        }

        const paymentId = String(pagamento.comprovante ?? '').trim();
        const valorPagamento = roundMoney(toNumber(pagamento.valor));
        const amount = roundMoney(Math.min(valorPagamento, restante));
        if (amount <= 0 || !paymentId) {
            continue;
        }

        distribuicao.push({
            idPagamentoHospedagem: pagamento.id,
            paymentId,
            amount,
        });
        restante = roundMoney(restante - amount);
    }

    return distribuicao;
}

export { SUITE_DISPONIBILIDADE_TZ as CANCELAMENTO_CLIENTE_TZ };
