import { Op, Transaction } from 'sequelize';
import axios from 'axios';
import {
    MercadoPagoConfig,
    Payment,
} from 'mercadopago';
import connection from '../database';
import { Empresa } from '../models/Empresa';
import { Evento } from '../models/Evento';
import {
    HistoricoTransacao,
    TipoPagamento,
    Transacao,
    TransacaoPagamento,
} from '../models/Transacao';
import { Usuario } from '../models/Usuario';
import {
    PagamentoHospedagem,
    FormaPagamentoRecepcaoValor,
    type FormaPagamentoRecepcao,
} from '../models/PagamentoHospedagem';
import { ReservaHospedagem } from '../models/ReservaHospedagem';
import { CustomError } from '../utils/customError';
import { calcularSaldoPendente } from '../utils/hospedagemPagamentoRecepcao';
import { roundMoney } from '../utils/reservaSuitePricing';
import { toNumber } from '../utils/reservaSuiteUtils';
import { resolverStatusTransacaoAposRecalculoValor } from './reservaSuiteFinanceiroService';
import {
    aplicarRemarcacaoPagaCliente,
    buscarRemarcacaoPendentePorReserva,
} from './hospedagemRemarcacaoClienteService';
import { assertUsuarioDonoReservaPublica } from './reservaSuiteService';
import {
    GATEWAY_PAGAMENTO_REMARCACAO,
    montarHistoricoPixRemarcacaoCriado,
    montarIdempotencyKeyRemarcacaoPix,
    parseHistoricoPixRemarcacao,
    PREFIXO_HISTORICO_PIX_REMARCACAO,
    TAXA_PLATAFORMA_REMARCACAO,
    TAXA_REMARCACAO_CLIENTE,
} from './hospedagemRemarcacaoClientePolicy';
import {
    garantirCaixaJangoAbertoParaHospedagem,
    persistirCaixaPagamentoHospedagem,
} from './hospedagemPagamentoService';

const TanzAcessToken = process.env.MP_TANZ_ACCESS_TOKEN || '';
const ClienteID = process.env.MP_CLIENT_ID || '';
const ClienteSecret = process.env.MP_CLIENT_SECRET || '';

const STATUS_PIX_REUTILIZAVEIS = new Set([
    'pending',
    'in_process',
    'authorized',
]);

export function statusPixRemarcacaoReutilizavel(
    status: string | undefined | null
): boolean {
    if (!status) {
        return false;
    }
    return STATUS_PIX_REUTILIZAVEIS.has(String(status));
}

async function renovarTokenSplitMercadoPago() {
    const empresa = await Empresa.findOne({ where: { id: 1 } });
    if (!empresa?.refreshToken) {
        throw new CustomError(
            'Empresa não encontrada ou refreshToken não definido',
            404,
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

export async function obterAccessTokenMercadoPagoRemarcacao(
    idEvento: number
): Promise<string> {
    const evento = await Evento.findByPk(idEvento);
    if (!evento) {
        throw new CustomError('Evento não encontrado.', 404, '');
    }

    if (evento.idProdutor !== 1) {
        return TanzAcessToken;
    }

    let empresa = await Empresa.findOne({ where: { id: 1 } });
    if (!empresa?.accessToken) {
        empresa = await renovarTokenSplitMercadoPago();
    }

    return empresa?.accessToken ?? TanzAcessToken;
}

export async function consultarPagamentoMercadoPagoRemarcacao(
    paymentId: string,
    idEvento: number
): Promise<Record<string, any>> {
    const accessToken = await obterAccessTokenMercadoPagoRemarcacao(idEvento);
    const response = await fetch(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        }
    );

    const data = await response.json();
    if (!response.ok) {
        throw new CustomError(
            'Não foi possível consultar o pagamento no Mercado Pago.',
            502,
            ''
        );
    }

    return data;
}

export async function buscarPaymentIdPixRemarcacaoPorTaxa(
    idTransacao: number,
    idTaxa: number
): Promise<string | null> {
    const historicos = await HistoricoTransacao.findAll({
        where: {
            idTransacao,
            descricao: {
                [Op.like]: `${PREFIXO_HISTORICO_PIX_REMARCACAO}${idTaxa})%`,
            },
        },
        order: [['id', 'DESC']],
        limit: 1,
    });

    for (const historico of historicos) {
        const parsed = parseHistoricoPixRemarcacao(historico.descricao);
        if (!parsed || parsed.idTaxa !== idTaxa) {
            continue;
        }

        const transacaoPagamento = await TransacaoPagamento.findOne({
            where: {
                idTransacao,
                PagamentoCodigo: parsed.paymentId,
                gatewayPagamento: GATEWAY_PAGAMENTO_REMARCACAO,
            },
        });

        if (transacaoPagamento) {
            return parsed.paymentId;
        }
    }

    return null;
}

async function validarContextoPagamentoRemarcacao(
    idReserva: number,
    idUsuario: number
) {
    const reserva = await ReservaHospedagem.findByPk(idReserva);
    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }
    assertUsuarioDonoReservaPublica(reserva, idUsuario);

    const pendente = await buscarRemarcacaoPendentePorReserva(idReserva);
    if (!pendente) {
        throw new CustomError(
            'Não há remarcação pendente de pagamento para esta reserva.',
            400,
            ''
        );
    }

    const saldoPendente =
        reserva.saldoPendente != null
            ? toNumber(reserva.saldoPendente)
            : calcularSaldoPendente(
                  toNumber(reserva.valorTotal),
                  toNumber(reserva.valorPago ?? 0)
              );

    if (saldoPendente < TAXA_REMARCACAO_CLIENTE - 0.009) {
        throw new CustomError(
            'O saldo pendente não corresponde à taxa de remarcação.',
            400,
            ''
        );
    }

    if (!reserva.idTransacao) {
        throw new CustomError(
            'Reserva sem transação vinculada para pagamento.',
            400,
            ''
        );
    }

    const transacao = await Transacao.findByPk(reserva.idTransacao);
    if (!transacao) {
        throw new CustomError('Transação não encontrada.', 404, '');
    }

    return { reserva, pendente, transacao, saldoPendente };
}

function montarApplicationFeeRemarcacao(idProdutor?: number | null): number {
    if (idProdutor === 1) {
        return TAXA_PLATAFORMA_REMARCACAO;
    }
    return 0;
}

function montarRespostaPixRemarcacao(params: {
    result: Record<string, any>;
    idTaxa: number;
    valorPagamento: number;
    applicationFee: number;
    reutilizado: boolean;
}) {
    return {
        id: params.result.id,
        status: params.result.status,
        status_detail: params.result.status_detail,
        point_of_interaction: params.result.point_of_interaction,
        idTaxa: params.idTaxa,
        valorPagamento: params.valorPagamento,
        applicationFee: params.applicationFee,
        reutilizado: params.reutilizado,
    };
}

async function registrarTransacaoPagamentoRemarcacao(params: {
    idTransacao: number;
    paymentId: string;
}) {
    const existente = await TransacaoPagamento.findOne({
        where: {
            idTransacao: params.idTransacao,
            PagamentoCodigo: params.paymentId,
            gatewayPagamento: GATEWAY_PAGAMENTO_REMARCACAO,
        },
    });
    if (existente) {
        return;
    }

    await TransacaoPagamento.create({
        idTransacao: params.idTransacao,
        PagamentoCodigo: String(params.paymentId),
        gatewayPagamento: GATEWAY_PAGAMENTO_REMARCACAO,
        valor: TAXA_REMARCACAO_CLIENTE,
        statusPagamento: 'Aguardando pagamento',
    });
}

export async function criarPagamentoPixRemarcacaoCliente(params: {
    idReserva: number;
    idUsuario: number;
    email: string;
}) {
    const { reserva, pendente, transacao } = await validarContextoPagamentoRemarcacao(
        params.idReserva,
        params.idUsuario
    );

    const idEvento = Number(transacao.idEvento);
    const evento = await Evento.findByPk(idEvento);
    const valorPagamento = TAXA_REMARCACAO_CLIENTE;
    const applicationFee = montarApplicationFeeRemarcacao(evento?.idProdutor);

    const paymentIdExistente = await buscarPaymentIdPixRemarcacaoPorTaxa(
        transacao.id,
        pendente.idTaxa
    );

    if (paymentIdExistente) {
        const pagamentoExistente = await consultarPagamentoMercadoPagoRemarcacao(
            paymentIdExistente,
            idEvento
        );

        if (pagamentoExistente.status === 'approved') {
            await processarPagamentoAprovadoRemarcacao({
                idReserva: params.idReserva,
                idUsuario: params.idUsuario,
                idTaxa: pendente.idTaxa,
                paymentId: paymentIdExistente,
                valorPago: valorPagamento,
                tipoPagamento: TipoPagamento.Pix,
            });

            return {
                ...montarRespostaPixRemarcacao({
                    result: pagamentoExistente,
                    idTaxa: pendente.idTaxa,
                    valorPagamento,
                    applicationFee,
                    reutilizado: true,
                }),
                remarcada: true,
            };
        }

        if (statusPixRemarcacaoReutilizavel(pagamentoExistente.status)) {
            return montarRespostaPixRemarcacao({
                result: pagamentoExistente,
                idTaxa: pendente.idTaxa,
                valorPagamento,
                applicationFee,
                reutilizado: true,
            });
        }
    }

    const usuario = await Usuario.findByPk(params.idUsuario);
    const accessToken = await obterAccessTokenMercadoPagoRemarcacao(idEvento);
    const client = new MercadoPagoConfig({ accessToken });
    const payment = new Payment(client);

    const body: Record<string, unknown> = {
        transaction_amount: valorPagamento,
        payment_method_id: 'pix',
        description: 'Taxa de remarcação de reserva',
        payer: {
            email: params.email,
            first_name: usuario?.nomeCompleto ?? '',
            last_name: usuario?.sobreNome ?? '',
        },
        external_reference: String(transacao.id),
        metadata: {
            remarcacao_cliente: true,
            id_reserva: reserva.id,
            id_taxa: pendente.idTaxa,
        },
        additional_info: {
            items: [
                {
                    id: `remarcacao-${pendente.idTaxa}`,
                    title: 'Taxa de remarcação',
                    description: 'Taxa de remarcação de reserva',
                    quantity: 1,
                    unit_price: valorPagamento,
                    category_id: 'services',
                },
            ],
        },
    };

    if (applicationFee > 0) {
        body.application_fee = applicationFee;
    }

    const result = await payment.create({
        body,
        requestOptions: {
            idempotencyKey: montarIdempotencyKeyRemarcacaoPix(pendente.idTaxa),
        },
    });

    if (result.id) {
        await registrarTransacaoPagamentoRemarcacao({
            idTransacao: transacao.id,
            paymentId: String(result.id),
        });
    }

    await HistoricoTransacao.create({
        idTransacao: transacao.id,
        idUsuario: params.idUsuario,
        data: new Date(),
        descricao: montarHistoricoPixRemarcacaoCriado(
            pendente.idTaxa,
            String(result.id)
        ),
    });

    return montarRespostaPixRemarcacao({
        result,
        idTaxa: pendente.idTaxa,
        valorPagamento,
        applicationFee,
        reutilizado: false,
    });
}

export async function criarPagamentoCartaoRemarcacaoCliente(params: {
    idReserva: number;
    idUsuario: number;
    token: string;
    payment_method_id: string;
    issuer_id?: string | number;
    installments: number;
    payer: { email: string; identification?: { type: string; number: string } };
    deviceId?: string;
}) {
    const { reserva, pendente, transacao } = await validarContextoPagamentoRemarcacao(
        params.idReserva,
        params.idUsuario
    );

    const usuario = await Usuario.findByPk(params.idUsuario);
    const idEvento = Number(transacao.idEvento);
    const accessToken = await obterAccessTokenMercadoPagoRemarcacao(idEvento);
    const client = new MercadoPagoConfig({ accessToken });
    const payment = new Payment(client);
    const evento = await Evento.findByPk(idEvento);
    const valorPagamento = TAXA_REMARCACAO_CLIENTE;

    const body: Record<string, unknown> = {
        transaction_amount: valorPagamento,
        token: params.token,
        description: 'Taxa de remarcação de reserva',
        installments: params.installments,
        payment_method_id: params.payment_method_id,
        issuer_id: params.issuer_id,
        payer: {
            ...params.payer,
            first_name: usuario?.nomeCompleto ?? '',
            last_name: usuario?.sobreNome ?? '',
        },
        metadata: {
            device_id: params.deviceId,
            remarcacao_cliente: true,
            id_reserva: reserva.id,
            id_taxa: pendente.idTaxa,
        },
        external_reference: String(transacao.id),
        additional_info: {
            items: [
                {
                    id: `remarcacao-${pendente.idTaxa}`,
                    title: 'Taxa de remarcação',
                    description: 'Taxa de remarcação de reserva',
                    quantity: 1,
                    unit_price: valorPagamento,
                    category_id: 'services',
                },
            ],
        },
    };

    const applicationFee = montarApplicationFeeRemarcacao(evento?.idProdutor);
    if (applicationFee > 0) {
        body.application_fee = applicationFee;
    }

    await HistoricoTransacao.create({
        idTransacao: transacao.id,
        idUsuario: params.idUsuario,
        data: new Date(),
        descricao: 'Tentativa pagamento remarcação com cartão',
    });

    const response = await payment.create({
        body,
        requestOptions: {
            idempotencyKey: montarIdempotencyKeyRemarcacaoPix(pendente.idTaxa),
        },
    });

    if (response.id) {
        await registrarTransacaoPagamentoRemarcacao({
            idTransacao: transacao.id,
            paymentId: String(response.id),
        });
    }

    if (response.status === 'approved') {
        await processarPagamentoAprovadoRemarcacao({
            idReserva: params.idReserva,
            idUsuario: params.idUsuario,
            idTaxa: pendente.idTaxa,
            paymentId: String(response.id),
            valorPago: valorPagamento,
            tipoPagamento: TipoPagamento.Credito,
        });
    }

    return {
        status: response.status,
        status_detail: response.status_detail,
        id: response.id,
        idTaxa: pendente.idTaxa,
        valorPagamento,
        applicationFee,
        remarcada: response.status === 'approved',
    };
}

async function registrarFinanceiroPagamentoRemarcacao(params: {
    idReserva: number;
    idUsuario: number;
    idTaxa: number;
    valorPago: number;
    comprovante: string;
    formaPagamento: FormaPagamentoRecepcao;
    tipoPagamento?: TipoPagamento | string | null;
    transaction: Transaction;
}): Promise<{ idPagamento: number; jaExistia: boolean }> {
    const reserva = await ReservaHospedagem.findByPk(params.idReserva, {
        transaction: params.transaction,
        lock: params.transaction.LOCK.UPDATE,
    });
    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    const dup = await PagamentoHospedagem.findOne({
        where: {
            idReservaHospedagem: params.idReserva,
            comprovante: params.comprovante,
        },
        transaction: params.transaction,
    });
    if (dup) {
        return { idPagamento: Number(dup.id), jaExistia: true };
    }

    const valorTotal = toNumber(reserva.valorTotal);
    const valorPagoAtual = toNumber(reserva.valorPago ?? 0);
    const novoValorPago = roundMoney(valorPagoAtual + params.valorPago);
    const novoSaldo = calcularSaldoPendente(valorTotal, novoValorPago);

    const pagamento = await PagamentoHospedagem.create(
        {
            idReservaHospedagem: params.idReserva,
            valor: params.valorPago,
            dataPagamento: new Date(),
            formaPagamento: params.formaPagamento,
            comprovante: params.comprovante,
            observacao: `Pagamento taxa de remarcação (taxa ${params.idTaxa})`,
            idUsuario: params.idUsuario,
        },
        { transaction: params.transaction }
    );

    await reserva.update(
        {
            valorPago: novoValorPago,
            saldoPendente: novoSaldo,
            formaPagamentoRecepcao: params.formaPagamento,
            comprovantePagamento: params.comprovante,
            observacaoPagamento: 'Pagamento taxa de remarcação (gateway).',
        },
        { transaction: params.transaction }
    );

    if (reserva.idTransacao) {
        const transacao = await Transacao.findByPk(reserva.idTransacao, {
            transaction: params.transaction,
            lock: params.transaction.LOCK.UPDATE,
        });
        if (transacao) {
            const valorRecebido = roundMoney(
                toNumber(transacao.valorRecebido ?? 0) + params.valorPago
            );
            const novoStatus = resolverStatusTransacaoAposRecalculoValor(
                toNumber(transacao.valorTotal),
                valorRecebido,
                transacao.status
            );
            const tipoPagamentoAtualizado =
                params.tipoPagamento &&
                Object.values(TipoPagamento).includes(
                    params.tipoPagamento as TipoPagamento
                )
                    ? (params.tipoPagamento as TipoPagamento)
                    : transacao.tipoPagamento;

            await transacao.update(
                {
                    valorRecebido,
                    status: novoStatus,
                    dataPagamento:
                        novoStatus === 'Pago' ? new Date() : transacao.dataPagamento,
                    tipoPagamento: tipoPagamentoAtualizado,
                    gatewayPagamento: GATEWAY_PAGAMENTO_REMARCACAO,
                },
                { transaction: params.transaction }
            );
        }
    }

    return { idPagamento: Number(pagamento.id), jaExistia: false };
}

function mapearFormaPagamentoRemarcacao(
    tipoPagamento?: TipoPagamento | string | null
): FormaPagamentoRecepcao {
    const tipo = String(tipoPagamento ?? '').toLowerCase();
    if (tipo.includes('pix')) {
        return FormaPagamentoRecepcaoValor.PIX;
    }
    if (tipo.includes('debito')) {
        return FormaPagamentoRecepcaoValor.CartaoDebito;
    }
    return FormaPagamentoRecepcaoValor.CartaoCredito;
}

export type ResultadoProcessamentoRemarcacao = {
    remarcada: boolean;
    jaProcessado: boolean;
    pagamentoRegistrado: boolean;
    erroAplicacao?: string;
};

async function registrarPagamentoRemarcacaoAprovado(params: {
    idReserva: number;
    idUsuario: number;
    idTaxa: number;
    paymentId: string;
    valorPago: number;
    tipoPagamento?: TipoPagamento | string | null;
}): Promise<{ idPagamento: number | null; jaExistia: boolean }> {
    let idPagamentoCriado: number | null = null;
    let jaExistia = false;

    await connection.transaction(async (t: Transaction) => {
        const formaPagamento = mapearFormaPagamentoRemarcacao(params.tipoPagamento);
        const resultado = await registrarFinanceiroPagamentoRemarcacao({
            idReserva: params.idReserva,
            idUsuario: params.idUsuario,
            idTaxa: params.idTaxa,
            valorPago: params.valorPago,
            comprovante: params.paymentId,
            formaPagamento,
            tipoPagamento: params.tipoPagamento,
            transaction: t,
        });
        idPagamentoCriado = resultado.idPagamento;
        jaExistia = resultado.jaExistia;
    });

    if (idPagamentoCriado && !jaExistia) {
        try {
            await garantirCaixaJangoAbertoParaHospedagem();
            await persistirCaixaPagamentoHospedagem(idPagamentoCriado);
        } catch (error) {
            console.error('Falha ao persistir caixa remarcação:', error);
        }
    }

    return { idPagamento: idPagamentoCriado, jaExistia };
}

export async function processarPagamentoAprovadoRemarcacao(params: {
    idReserva: number;
    idUsuario: number;
    idTaxa: number;
    paymentId: string;
    valorPago: number;
    tipoPagamento?: TipoPagamento | string | null;
}): Promise<ResultadoProcessamentoRemarcacao> {
    const pendente = await buscarRemarcacaoPendentePorReserva(params.idReserva);
    if (!pendente || pendente.idTaxa !== params.idTaxa) {
        return {
            remarcada: true,
            jaProcessado: true,
            pagamentoRegistrado: true,
        };
    }

    const pagamentoJaRegistrado = await PagamentoHospedagem.findOne({
        where: {
            idReservaHospedagem: params.idReserva,
            comprovante: params.paymentId,
        },
    });

    if (!pagamentoJaRegistrado) {
        await registrarPagamentoRemarcacaoAprovado(params);
    }

    try {
        await aplicarRemarcacaoPagaCliente({
            idReserva: params.idReserva,
            idUsuario: params.idUsuario,
            idTaxa: params.idTaxa,
            valorPago: params.valorPago,
            comprovante: params.paymentId,
            formaPagamento: mapearFormaPagamentoRemarcacao(params.tipoPagamento),
        });
    } catch (error) {
        const mensagem =
            error instanceof CustomError
                ? error.message
                : 'Não foi possível aplicar a remarcação após o pagamento.';
        return {
            remarcada: false,
            jaProcessado: false,
            pagamentoRegistrado: true,
            erroAplicacao: mensagem,
        };
    }

    return {
        remarcada: true,
        jaProcessado: false,
        pagamentoRegistrado: true,
    };
}

export async function consultarPagamentoRemarcacaoCliente(params: {
    idReserva: number;
    idUsuario: number;
    paymentId: string;
}) {
    const { pendente, transacao } = await validarContextoPagamentoRemarcacao(
        params.idReserva,
        params.idUsuario
    );

    const idEvento = Number(transacao.idEvento);
    const data = await consultarPagamentoMercadoPagoRemarcacao(
        params.paymentId,
        idEvento
    );

    let remarcada = false;
    let erroAplicacao: string | undefined;
    let pagamentoRegistrado = false;

    if (data.status === 'approved') {
        const resultado = await processarPagamentoAprovadoRemarcacao({
            idReserva: params.idReserva,
            idUsuario: params.idUsuario,
            idTaxa: pendente.idTaxa,
            paymentId: String(params.paymentId),
            valorPago: TAXA_REMARCACAO_CLIENTE,
            tipoPagamento:
                data.payment_type_id === 'bank_transfer'
                    ? TipoPagamento.Pix
                    : TipoPagamento.Credito,
        });
        remarcada = resultado.remarcada;
        erroAplicacao = resultado.erroAplicacao;
        pagamentoRegistrado = resultado.pagamentoRegistrado;

        if (transacao.id) {
            await Transacao.update(
                {
                    valorTaxaProcessamento:
                        data.fee_details?.find(
                            (fee: { type?: string }) =>
                                fee.type === 'mercadopago_fee'
                        )?.amount ?? 0,
                    valorRecebido:
                        data.transaction_details?.net_received_amount ?? undefined,
                    idTransacaoRecebidoMP: String(params.paymentId),
                },
                { where: { id: transacao.id } }
            );
        }
    }

    const reservaAtualizada = await ReservaHospedagem.findByPk(params.idReserva);
    const pendenteApos = await buscarRemarcacaoPendentePorReserva(params.idReserva);

    return {
        status: data.status,
        status_detail: data.status_detail,
        remarcada,
        erroAplicacao,
        pagamentoRegistrado,
        aguardandoPagamento: Boolean(pendenteApos),
        reserva: reservaAtualizada
            ? {
                  checkin: reservaAtualizada.checkin,
                  checkout: reservaAtualizada.checkout,
                  valorPago: reservaAtualizada.valorPago,
                  saldoPendente: reservaAtualizada.saldoPendente,
              }
            : null,
    };
}

export async function obterPixRemarcacaoPendenteCliente(
    idReserva: number,
    idUsuario: number
) {
    const { pendente, transacao } = await validarContextoPagamentoRemarcacao(
        idReserva,
        idUsuario
    );

    const paymentId = await buscarPaymentIdPixRemarcacaoPorTaxa(
        transacao.id,
        pendente.idTaxa
    );

    if (!paymentId) {
        return null;
    }

    const idEvento = Number(transacao.idEvento);
    const pagamento = await consultarPagamentoMercadoPagoRemarcacao(
        paymentId,
        idEvento
    );

    return {
        paymentId,
        status: pagamento.status,
        point_of_interaction: pagamento.point_of_interaction,
        reutilizado: true,
        idTaxa: pendente.idTaxa,
        valorPagamento: TAXA_REMARCACAO_CLIENTE,
    };
}
