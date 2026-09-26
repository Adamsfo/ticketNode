import { Op, Transaction } from 'sequelize';
import {
    HistoricoTransacao,
    TransacaoPagamento,
} from '../models/Transacao';
import { StatusReservaHospedagem } from '../models/ReservaHospedagem';

/** Históricos gravados ao iniciar cobrança no gateway (antes da aprovação). */
export const DESCRICOES_HISTORICO_PAGAMENTO_GATEWAY_INICIADO = [
    'Tentativa Pagamento com Cartão Crédito',
    'Pagamento via Pix Criado',
] as const;

export type DecisaoConfirmacaoPosPagamentoExpirada =
    | 'confirmar'
    | 'transacao_nao_paga'
    | 'reserva_nao_ligada'
    | 'sem_pagamento_iniciado'
    | 'suite_indisponivel';

/**
 * Indica que o cliente chegou a iniciar cobrança no gateway para esta transação
 * (PIX/cartão MP), distinguindo de tentativa de pagamento novo após expiração.
 */
export async function transacaoPossuiPagamentoGatewayIniciado(
    idTransacao: number,
    transaction?: Transaction
): Promise<boolean> {
    const id = Number(idTransacao);
    if (!(id > 0)) {
        return false;
    }

    const pagamento = await TransacaoPagamento.findOne({
        where: { idTransacao: id },
        attributes: ['id'],
        ...(transaction ? { transaction } : {}),
    });
    if (pagamento) {
        return true;
    }

    const historico = await HistoricoTransacao.findOne({
        where: {
            idTransacao: id,
            descricao: {
                [Op.in]: [...DESCRICOES_HISTORICO_PAGAMENTO_GATEWAY_INICIADO],
            },
        },
        attributes: ['id'],
        ...(transaction ? { transaction } : {}),
    });
    return Boolean(historico);
}

export function decidirConfirmacaoReservaExpiradaPosPagamento(params: {
    transacaoStatus: string;
    idTransacao: number;
    reservaIdTransacao: number | null | undefined;
    pagamentoGatewayIniciado: boolean;
    suitesDisponiveis: boolean;
}): DecisaoConfirmacaoPosPagamentoExpirada {
    if (params.transacaoStatus !== 'Pago') {
        return 'transacao_nao_paga';
    }
    if (Number(params.reservaIdTransacao) !== Number(params.idTransacao)) {
        return 'reserva_nao_ligada';
    }
    if (!params.pagamentoGatewayIniciado) {
        return 'sem_pagamento_iniciado';
    }
    if (!params.suitesDisponiveis) {
        return 'suite_indisponivel';
    }
    return 'confirmar';
}

export function reservaElegivelFluxoConfirmacaoPosPagamento(
    status: StatusReservaHospedagem | string
): boolean {
    return (
        status === StatusReservaHospedagem.AguardandoPagamento ||
        status === StatusReservaHospedagem.Confirmada ||
        status === StatusReservaHospedagem.Expirada
    );
}

/** Bloqueio de novo pagamento quando a reserva já foi marcada como Expirada. */
export function reservaBloqueiaInicioPagamentoPorExpirada(
    status: StatusReservaHospedagem | string
): boolean {
    return status === StatusReservaHospedagem.Expirada;
}
