import { StatusReservaHospedagem } from '../models/ReservaHospedagem';
import { calcularHorasRestantesCheckin } from './hospedagemCancelamentoClientePolicy';

/** Origens externas / operacionais que o cliente não pode remarcar. */
const ORIGENS_RESERVA_BLOQUEADAS_REMARCACAO_CLIENTE = new Set([
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
const ORIGENS_RESERVA_SITE_CLIENTE_REMARCACAO = new Set(['CLIENTE', 'SITE']);

function normalizarOrigemReservaRemarcacao(
    origemReserva: string | null | undefined
): string {
    return String(origemReserva ?? '')
        .trim()
        .toUpperCase();
}

/**
 * Origens elegíveis para remarcação pelo cliente.
 * Regra isolada da remarcação — não avalia pagamento nem estorno.
 */
export function isOrigemRemarcacaoClientePermitida(reserva: {
    origemReserva?: string | null;
    tokenPagamento?: string | null;
}): boolean {
    const origem = normalizarOrigemReservaRemarcacao(reserva.origemReserva);

    if (ORIGENS_RESERVA_BLOQUEADAS_REMARCACAO_CLIENTE.has(origem)) {
        return false;
    }

    if (origem === 'HOSPEDIN') {
        return false;
    }

    if (
        ORIGENS_RESERVA_SITE_CLIENTE_REMARCACAO.has(origem) ||
        origem === 'LINK_CLIENTE'
    ) {
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

/** Configuração central dos valores da taxa de remarcação pelo cliente. */
export const TAXA_REMARCACAO_CLIENTE = 120;
export const TAXA_PLATAFORMA_REMARCACAO = 20;
export const VALOR_POUSADA_REMARCACAO =
    TAXA_REMARCACAO_CLIENTE - TAXA_PLATAFORMA_REMARCACAO;

export const DESCRICAO_TAXA_REMARCACAO = 'Taxa de remarcação';

export const MARCA_REMARCACAO_CLIENTE = '[RemarcacaoCliente';
export const ESTADO_REMARCACAO_PENDENTE = 'PENDENTE';
export const ESTADO_REMARCACAO_CONCLUIDA = 'CONCLUIDA';
export const ESTADO_REMARCACAO_CANCELADA = 'CANCELADA';

/** Gateway isolado — evita processamento pelo webhook genérico de hospedagem. */
export const GATEWAY_PAGAMENTO_REMARCACAO = 'MercadoPagoRemarcacao';

export const PREFIXO_HISTORICO_PIX_REMARCACAO = 'PIX remarcação criado (taxa ';

export function montarIdempotencyKeyRemarcacaoPix(idTaxa: number): string {
    return `remarcacao-cliente-taxa-${idTaxa}`;
}

export function montarHistoricoPixRemarcacaoCriado(
    idTaxa: number,
    paymentId: string
): string {
    return `${PREFIXO_HISTORICO_PIX_REMARCACAO}${idTaxa}) — payment ${paymentId}`;
}

export function parseHistoricoPixRemarcacao(
    descricao: string | null | undefined
): { idTaxa: number; paymentId: string } | null {
    const texto = String(descricao ?? '').trim();
    if (!texto.startsWith(PREFIXO_HISTORICO_PIX_REMARCACAO)) {
        return null;
    }

    const taxaMatch = texto.match(/\(taxa (\d+)\)/);
    const paymentMatch = texto.match(/payment (\d+)/);
    const idTaxa = Number(taxaMatch?.[1]);
    const paymentId = paymentMatch?.[1] ? String(paymentMatch[1]) : '';

    if (!Number.isFinite(idTaxa) || idTaxa <= 0 || !paymentId) {
        return null;
    }

    return { idTaxa, paymentId };
}

export type TaxaRemarcacaoCliente = 0 | typeof TAXA_REMARCACAO_CLIENTE;

export type ElegibilidadeRemarcacaoCliente = {
    podeRemarcar: boolean;
    motivoBloqueio: string | null;
    horasRestantes: number;
    taxaRemarcacao: TaxaRemarcacaoCliente | null;
    taxaPlataforma: number | null;
    taxaJango: number | null;
};

function toNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

export function calcularTaxaRemarcacaoCliente(
    horasRestantes: number
): TaxaRemarcacaoCliente | null {
    if (horasRestantes <= 12) {
        return null;
    }
    if (horasRestantes > 72) {
        return 0;
    }
    return TAXA_REMARCACAO_CLIENTE;
}

export function calcularSplitTaxaRemarcacao(
    taxa: TaxaRemarcacaoCliente
): { plataforma: number; jango: number } {
    if (taxa <= 0) {
        return { plataforma: 0, jango: 0 };
    }
    return {
        plataforma: TAXA_PLATAFORMA_REMARCACAO,
        jango: VALOR_POUSADA_REMARCACAO,
    };
}

export function calcularSaldoAposTaxaRemarcacao(params: {
    valorTotalAtual: number;
    valorPago: number;
    taxaRemarcacao: number;
}): {
    valorTotal: number;
    valorPago: number;
    saldoPendente: number;
} {
    const valorTotal = roundMoney(
        toNumber(params.valorTotalAtual) + toNumber(params.taxaRemarcacao)
    );
    const valorPago = roundMoney(toNumber(params.valorPago));
    const saldoPendente = roundMoney(Math.max(0, valorTotal - valorPago));
    return { valorTotal, valorPago, saldoPendente };
}

export function montarHistoricoRemarcacaoPendente(params: {
    idReserva: number;
    idTaxa: number;
    checkin: Date;
    checkout: Date;
}): string {
    return (
        `${MARCA_REMARCACAO_CLIENTE}|${ESTADO_REMARCACAO_PENDENTE}` +
        `|reserva=${params.idReserva}` +
        `|taxa=${params.idTaxa}` +
        `|checkin=${params.checkin.toISOString()}` +
        `|checkout=${params.checkout.toISOString()}]`
    );
}

export function montarHistoricoRemarcacaoConcluida(idTaxa: number): string {
    return `${MARCA_REMARCACAO_CLIENTE}|${ESTADO_REMARCACAO_CONCLUIDA}|taxa=${idTaxa}]`;
}

export type RemarcacaoPendenteHistorico = {
    idHistorico?: number;
    idReserva: number;
    idTaxa: number;
    checkin: Date;
    checkout: Date;
};

export function parseHistoricoRemarcacaoPendente(
    descricao: string | null | undefined
): RemarcacaoPendenteHistorico | null {
    const texto = String(descricao ?? '').trim();
    if (!texto.startsWith(MARCA_REMARCACAO_CLIENTE)) {
        return null;
    }
    if (!texto.includes(`|${ESTADO_REMARCACAO_PENDENTE}|`)) {
        return null;
    }

    const reservaMatch = texto.match(/\|reserva=(\d+)/);
    const taxaMatch = texto.match(/\|taxa=(\d+)/);
    const checkinMatch = texto.match(/\|checkin=([^|\]]+)/);
    const checkoutMatch = texto.match(/\|checkout=([^|\]]+)/);

    const idReserva = Number(reservaMatch?.[1]);
    const idTaxa = Number(taxaMatch?.[1]);
    const checkin = checkinMatch?.[1] ? new Date(checkinMatch[1]) : null;
    const checkout = checkoutMatch?.[1] ? new Date(checkoutMatch[1]) : null;

    if (
        !Number.isFinite(idReserva) ||
        idReserva <= 0 ||
        !Number.isFinite(idTaxa) ||
        idTaxa <= 0 ||
        !checkin ||
        Number.isNaN(checkin.getTime()) ||
        !checkout ||
        Number.isNaN(checkout.getTime())
    ) {
        return null;
    }

    return { idReserva, idTaxa, checkin, checkout };
}

export function isHistoricoRemarcacaoConcluida(
    descricao: string | null | undefined,
    idTaxa: number
): boolean {
    const texto = String(descricao ?? '').trim();
    return texto.includes(
        `${MARCA_REMARCACAO_CLIENTE}|${ESTADO_REMARCACAO_CONCLUIDA}|taxa=${idTaxa}]`
    );
}

export function avaliarElegibilidadeRemarcacaoCliente(params: {
    reserva: {
        status: string;
        origemReserva?: string | null;
        tokenPagamento?: string | null;
        checkin: Date | string;
    };
    agora?: Date;
}): ElegibilidadeRemarcacaoCliente {
    const status = String(params.reserva.status);
    const horasRestantes = calcularHorasRestantesCheckin(
        params.reserva.checkin,
        params.agora ?? new Date()
    );

    if (status === StatusReservaHospedagem.Cancelada) {
        return {
            podeRemarcar: false,
            motivoBloqueio: 'Esta reserva está cancelada.',
            horasRestantes,
            taxaRemarcacao: null,
            taxaPlataforma: null,
            taxaJango: null,
        };
    }

    if (status === StatusReservaHospedagem.Hospedada) {
        return {
            podeRemarcar: false,
            motivoBloqueio: 'Reservas já hospedadas não podem ser remarcadas.',
            horasRestantes,
            taxaRemarcacao: null,
            taxaPlataforma: null,
            taxaJango: null,
        };
    }

    if (status === StatusReservaHospedagem.CheckOutRealizado) {
        return {
            podeRemarcar: false,
            motivoBloqueio: 'Esta reserva já foi finalizada.',
            horasRestantes,
            taxaRemarcacao: null,
            taxaPlataforma: null,
            taxaJango: null,
        };
    }

    if (status === StatusReservaHospedagem.Expirada) {
        return {
            podeRemarcar: false,
            motivoBloqueio: 'Esta reserva está expirada.',
            horasRestantes,
            taxaRemarcacao: null,
            taxaPlataforma: null,
            taxaJango: null,
        };
    }

    if (status === StatusReservaHospedagem.AguardandoPagamento) {
        return {
            podeRemarcar: false,
            motivoBloqueio:
                'Somente reservas confirmadas podem ser remarcadas.',
            horasRestantes,
            taxaRemarcacao: null,
            taxaPlataforma: null,
            taxaJango: null,
        };
    }

    if (status !== StatusReservaHospedagem.Confirmada) {
        return {
            podeRemarcar: false,
            motivoBloqueio: 'Somente reservas confirmadas podem ser remarcadas.',
            horasRestantes,
            taxaRemarcacao: null,
            taxaPlataforma: null,
            taxaJango: null,
        };
    }

    if (!isOrigemRemarcacaoClientePermitida(params.reserva)) {
        return {
            podeRemarcar: false,
            motivoBloqueio:
                'Esta reserva não pode ser remarcada pelo cliente neste canal.',
            horasRestantes,
            taxaRemarcacao: null,
            taxaPlataforma: null,
            taxaJango: null,
        };
    }

    const taxaRemarcacao = calcularTaxaRemarcacaoCliente(horasRestantes);
    if (taxaRemarcacao == null) {
        return {
            podeRemarcar: false,
            motivoBloqueio:
                'Remarcação não permitida com menos de 12 horas para o check-in.',
            horasRestantes,
            taxaRemarcacao: null,
            taxaPlataforma: null,
            taxaJango: null,
        };
    }

    const split = calcularSplitTaxaRemarcacao(taxaRemarcacao);
    return {
        podeRemarcar: true,
        motivoBloqueio: null,
        horasRestantes,
        taxaRemarcacao,
        taxaPlataforma: split.plataforma,
        taxaJango: split.jango,
    };
}
