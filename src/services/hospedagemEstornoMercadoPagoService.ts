import axios from 'axios';
import { MercadoPagoConfig, PaymentRefund } from 'mercadopago';
import { Op } from 'sequelize';
import { Empresa } from '../models/Empresa';
import { Evento } from '../models/Evento';
import {
    HistoricoTransacao,
    Transacao,
    TransacaoPagamento,
} from '../models/Transacao';
import { CustomError } from '../utils/customError';
import {
    distribuirEstornoMercadoPago,
    type PagamentoHospedagemResumo,
} from './hospedagemCancelamentoClientePolicy';

const ClienteID = process.env.MP_CLIENT_ID || '';
const ClienteSecret = process.env.MP_CLIENT_SECRET || '';
const TanzAcessToken = process.env.MP_TANZ_ACCESS_TOKEN || '';

export type EstornoMercadoPagoExecutado = {
    paymentId: string;
    amount: number;
    refundId?: number;
    status?: string;
    idPagamentoHospedagem: number;
};

async function geraTokenSplitMercadoPago() {
    const empresa = await Empresa.findOne({ where: { id: 1 } });
    if (!empresa || !empresa.refreshToken) {
        throw new CustomError(
            'Empresa não encontrada ou refreshToken não definido.',
            500,
            ''
        );
    }

    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: ClienteID,
        client_secret: ClienteSecret,
        refresh_token: empresa.refreshToken,
    });

    const response = await axios.post(
        'https://api.mercadopago.com/oauth/token',
        body,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    empresa.accessToken = response.data.access_token;
    empresa.refreshToken = response.data.refresh_token;
    await empresa.save();
    return empresa;
}

export async function resolverMercadoPagoAccessToken(
    idEvento: number
): Promise<string> {
    const evento = await Evento.findByPk(idEvento);
    if (!evento) {
        throw new CustomError('Evento da reserva não encontrado.', 404, '');
    }

    if (evento.idProdutor === 1) {
        let empresa = await Empresa.findOne({ where: { id: 1 } });
        if (!empresa || !empresa.accessToken) {
            empresa = await geraTokenSplitMercadoPago();
        }
        if (!empresa?.accessToken) {
            throw new CustomError(
                'Token Mercado Pago indisponível para o evento.',
                500,
                ''
            );
        }
        return empresa.accessToken;
    }

    if (!TanzAcessToken) {
        throw new CustomError('Token Mercado Pago indisponível.', 500, '');
    }

    return TanzAcessToken;
}

export async function validarPagamentoMercadoPagoDaReserva(
    paymentId: string,
    idTransacaoPrincipal?: number | null
): Promise<boolean> {
    const codigo = String(paymentId ?? '').trim();
    if (!codigo) {
        return false;
    }

    const registro = await TransacaoPagamento.findOne({
        where: {
            PagamentoCodigo: codigo,
            gatewayPagamento: { [Op.like]: '%Mercado%' },
        },
    });
    if (registro) {
        return true;
    }

    if (idTransacaoPrincipal) {
        const transacao = await Transacao.findByPk(idTransacaoPrincipal);
        if (String(transacao?.idTransacaoRecebidoMP ?? '').trim() === codigo) {
            return true;
        }
    }

    return false;
}

export async function executarEstornosMercadoPagoHospedagem(params: {
    idEvento: number;
    idTransacaoPrincipal?: number | null;
    idTransacaoHistorico?: number | null;
    idUsuario: number;
    pagamentos: PagamentoHospedagemResumo[];
    valorEstornoTotal: number;
}): Promise<EstornoMercadoPagoExecutado[]> {
    const distribuicao = distribuirEstornoMercadoPago(
        params.pagamentos,
        params.valorEstornoTotal
    );

    if (distribuicao.length <= 0) {
        return [];
    }

    const accessToken = await resolverMercadoPagoAccessToken(params.idEvento);
    const client = new MercadoPagoConfig({ accessToken });
    const paymentRefund = new PaymentRefund(client);
    const executados: EstornoMercadoPagoExecutado[] = [];

    for (const item of distribuicao) {
        const valido = await validarPagamentoMercadoPagoDaReserva(
            item.paymentId,
            params.idTransacaoPrincipal
        );
        if (!valido) {
            throw new CustomError(
                `Pagamento ${item.paymentId} não é elegível para estorno Mercado Pago.`,
                400,
                ''
            );
        }

        try {
            const response = await paymentRefund.create({
                payment_id: item.paymentId,
                body: { amount: item.amount },
            });

            executados.push({
                paymentId: item.paymentId,
                amount: item.amount,
                refundId: response.id,
                status: response.status,
                idPagamentoHospedagem: item.idPagamentoHospedagem,
            });
        } catch (error: any) {
            const detalhe =
                error?.response?.data?.message ||
                error?.message ||
                'Erro desconhecido';
            throw new CustomError(
                `Falha ao estornar pagamento Mercado Pago: ${detalhe}`,
                502,
                ''
            );
        }
    }

    if (params.idTransacaoHistorico) {
        const linhas = executados
            .map(
                (item) =>
                    `MP ${item.paymentId}: R$ ${item.amount.toFixed(2)} (refund ${item.refundId ?? '—'})`
            )
            .join('; ');
        await HistoricoTransacao.create({
            idTransacao: params.idTransacaoHistorico,
            idUsuario: params.idUsuario,
            data: new Date(),
            descricao: `[CancelamentoCliente] Estorno Mercado Pago: ${linhas}`,
        });
    }

    return executados;
}
