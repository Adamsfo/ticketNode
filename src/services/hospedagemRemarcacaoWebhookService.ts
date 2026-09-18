import { ReservaHospedagem } from '../models/ReservaHospedagem';
import {
    TipoPagamento,
    Transacao,
    TransacaoPagamento,
} from '../models/Transacao';
import {
    GATEWAY_PAGAMENTO_REMARCACAO,
    TAXA_REMARCACAO_CLIENTE,
} from './hospedagemRemarcacaoClientePolicy';
import {
    buscarRemarcacaoPendentePorReserva,
} from './hospedagemRemarcacaoClienteService';
import {
    consultarPagamentoMercadoPagoRemarcacao,
    obterAccessTokenMercadoPagoRemarcacao,
    processarPagamentoAprovadoRemarcacao,
} from './hospedagemRemarcacaoPagamentoService';

export type ResultadoWebhookRemarcacao = {
    processado: boolean;
    ignorado: boolean;
    remarcada?: boolean;
    erroAplicacao?: string;
};

/**
 * Tratamento isolado de webhook Mercado Pago para pagamentos de remarcação.
 * Pagamentos com gateway `MercadoPagoRemarcacao` não são processados pelo webhook genérico.
 */
export async function processarWebhookMercadoPagoRemarcacao(
    paymentId: string
): Promise<ResultadoWebhookRemarcacao> {
    const transacaoPagamento = await TransacaoPagamento.findOne({
        where: {
            PagamentoCodigo: paymentId,
            gatewayPagamento: GATEWAY_PAGAMENTO_REMARCACAO,
        },
    });

    if (!transacaoPagamento) {
        return { processado: false, ignorado: true };
    }

    const transacao = await Transacao.findByPk(transacaoPagamento.idTransacao);
    if (!transacao) {
        return { processado: false, ignorado: true };
    }

    const idEvento = Number(transacao.idEvento);
    const data = await consultarPagamentoMercadoPagoRemarcacao(
        paymentId,
        idEvento
    );

    if (data.status !== 'approved') {
        return { processado: true, ignorado: false, remarcada: false };
    }

    const reserva = await ReservaHospedagem.findOne({
        where: { idTransacao: transacao.id },
    });
    if (!reserva) {
        return { processado: false, ignorado: true };
    }

    const pendente = await buscarRemarcacaoPendentePorReserva(reserva.id);
    if (!pendente) {
        return { processado: true, ignorado: false, remarcada: true };
    }

    transacao.valorTaxaProcessamento =
        data.fee_details?.find(
            (fee: { type?: string }) => fee.type === 'mercadopago_fee'
        )?.amount || 0;
    transacao.valorRecebido =
        data.transaction_details?.net_received_amount || 0;
    transacao.idTransacaoRecebidoMP = paymentId;
    await transacao.save();

    const resultado = await processarPagamentoAprovadoRemarcacao({
        idReserva: reserva.id,
        idUsuario: Number(reserva.idUsuario || transacao.idUsuario),
        idTaxa: pendente.idTaxa,
        paymentId,
        valorPago: TAXA_REMARCACAO_CLIENTE,
        tipoPagamento:
            data.payment_type_id === 'bank_transfer'
                ? TipoPagamento.Pix
                : TipoPagamento.Credito,
    });

    return {
        processado: true,
        ignorado: false,
        remarcada: resultado.remarcada,
        erroAplicacao: resultado.erroAplicacao,
    };
}

export async function resolverTokenConsultaWebhookRemarcacao(
    paymentId: string
): Promise<string | null> {
    const transacaoPagamento = await TransacaoPagamento.findOne({
        where: {
            PagamentoCodigo: paymentId,
            gatewayPagamento: GATEWAY_PAGAMENTO_REMARCACAO,
        },
    });
    if (!transacaoPagamento) {
        return null;
    }

    const transacao = await Transacao.findByPk(transacaoPagamento.idTransacao);
    if (!transacao?.idEvento) {
        return null;
    }

    return obterAccessTokenMercadoPagoRemarcacao(Number(transacao.idEvento));
}
