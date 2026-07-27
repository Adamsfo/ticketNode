/**
 * Fluxo financeiro da Hospedagem — mesma arquitetura de identificação SuperTEF dos ingressos:
 * cria Transacao → usa Transacao.id como order_id → SuperTEF → HospedagemPagamentoOperacao
 * → PagamentoHospedagem / ReservaHospedagem.
 *
 * Não altera PagamentoController nem PagamentoPDV.
 */
import axios from 'axios';
import { Transaction } from 'sequelize';
import { randomUUID } from 'crypto';
import connection from '../database';
import { Evento } from '../models/Evento';
import { ProdutorAcesso, TipoAcesso } from '../models/Produtor';
import {
    ReservaHospedagem,
    StatusReservaHospedagem,
} from '../models/ReservaHospedagem';
import {
    PagamentoHospedagem,
    type FormaPagamentoRecepcao,
} from '../models/PagamentoHospedagem';
import {
    HospedagemPagamentoOperacao,
    HospedagemPagamentoOperacaoOrigem,
    HospedagemPagamentoOperacaoStatus,
    HospedagemPagamentoOperacaoTipo,
} from '../models/HospedagemPagamentoOperacao';
import {
    HistoricoTransacao,
    OrigemTransacao,
    TipoPagamento,
    Transacao,
} from '../models/Transacao';
import { Usuario } from '../models/Usuario';
import { CustomError } from '../utils/customError';
import { toNumber } from '../utils/reservaSuiteUtils';
import { roundMoney } from '../utils/reservaSuitePricing';
import {
    calcularSaldoPendente,
    isFormaPagamentoRecepcao,
    parsePagamentoRecepcao,
    type PagamentoRecepcaoInput,
} from '../utils/hospedagemPagamentoRecepcao';
import { obterReservaAdminDetalhe } from './hospedagemAdminService';

/** Mesmo token/env do PagamentoPDV — sem alterar o controller do PDV. */
const SuperTefBearerToken = process.env.SUPERTEF_BEARER_TOKEN || '';

const STATUS_PERMITIDOS = new Set<string>([
    StatusReservaHospedagem.Confirmada,
    StatusReservaHospedagem.Hospedada,
    StatusReservaHospedagem.AguardandoPagamento,
]);

async function resolverEscopoProdutor(idUsuario: number): Promise<{
    admGeral: boolean;
    idsProdutor: number[];
}> {
    const usuario = await Usuario.findByPk(idUsuario, {
        attributes: ['id', 'admGeral'],
    });
    if (!usuario) {
        throw new CustomError('Usuário não autenticado.', 401, '');
    }
    if (usuario.admGeral) {
        return { admGeral: true, idsProdutor: [] };
    }

    const acessos = await ProdutorAcesso.findAll({
        where: { idUsuario },
        attributes: ['idProdutor'],
    });
    const idsProdutor = [
        ...new Set(
            acessos
                .map((a) => Number(a.idProdutor))
                .filter((id) => Number.isFinite(id) && id > 0)
        ),
    ];
    if (idsProdutor.length === 0) {
        throw new CustomError(
            'Usuário sem acesso a produtores de hospedagem.',
            403,
            ''
        );
    }
    return { admGeral: false, idsProdutor };
}

async function carregarReservaAutorizada(
    idReservaHospedagem: number,
    idUsuario: number
) {
    const escopo = await resolverEscopoProdutor(idUsuario);
    const reserva = (await ReservaHospedagem.findByPk(idReservaHospedagem, {
        include: [
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'idProdutor'],
                required: true,
            },
        ],
    })) as
        | (ReservaHospedagem & {
              Evento?: { id: number; idProdutor?: number } | null;
              valorPago?: number;
              saldoPendente?: number | null;
          })
        | null;

    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }
    if (
        !escopo.admGeral &&
        !escopo.idsProdutor.includes(Number(reserva.Evento?.idProdutor))
    ) {
        throw new CustomError('Sem permissão para esta reserva.', 403, '');
    }
    if (!STATUS_PERMITIDOS.has(String(reserva.status))) {
        throw new CustomError(
            'Não é possível receber saldo para esta reserva no status atual.',
            400,
            ''
        );
    }
    return reserva;
}

function resolverSaldoAtual(
    reserva: ReservaHospedagem & {
        valorPago?: number;
        saldoPendente?: number | null;
    }
) {
    const valorTotal = roundMoney(toNumber(reserva.valorTotal));
    const valorPago = roundMoney(toNumber(reserva.valorPago ?? 0));
    const saldoCalculado = calcularSaldoPendente(valorTotal, valorPago);
    const saldoColuna =
        reserva.saldoPendente != null && reserva.saldoPendente !== undefined
            ? roundMoney(toNumber(reserva.saldoPendente))
            : null;
    const colunaConfiavel =
        saldoColuna != null &&
        Math.abs(saldoColuna - saldoCalculado) <= 0.009;
    return {
        valorTotal,
        valorPago,
        saldoPendente: colunaConfiavel ? saldoColuna! : saldoCalculado,
    };
}

function formaPorTransactionType(
    transactionType: number
): FormaPagamentoRecepcao {
    if (transactionType === 1) return 'CartaoDebito';
    if (transactionType === 2) return 'CartaoCredito';
    if (transactionType === 3) return 'PIX';
    throw new CustomError('transaction_type inválido.', 400, '');
}

/** Mesmo mapeamento de tipoPagamento do PagamentoPDV (transaction_type → enum). */
function tipoPagamentoPorTransactionType(
    transactionType: number
): TipoPagamento {
    if (transactionType === 1) return TipoPagamento.Debito;
    if (transactionType === 2) return TipoPagamento.Credito;
    if (transactionType === 3) return TipoPagamento.Pix;
    throw new CustomError('transaction_type inválido.', 400, '');
}

function comprovantePorPaymentUniqueId(paymentUniqueId: string): string {
    return String(paymentUniqueId || '');
}

/**
 * Cria Transacao para Receber Saldo (hospedagem), no mesmo padrão de
 * TransacaoController.add / reservaSuiteService — sem alterar esses fluxos.
 * O ID gerado será o order_id do SuperTEF (igual aos ingressos).
 */
async function criarTransacaoReceberSaldoHospedagem(params: {
    idUsuario: number;
    idEvento: number;
    valorTotal: number;
    transactionType: number;
}) {
    const valorTotal = roundMoney(Number(params.valorTotal));
    const dataTransacao = new Date();
    const transacao = await Transacao.create({
        idUsuario: params.idUsuario,
        dataTransacao,
        preco: valorTotal,
        taxaServico: 0,
        valorTotal,
        status: 'Aguardando pagamento',
        aceiteCompra: true,
        idEvento: params.idEvento,
        tipoPagamento: tipoPagamentoPorTransactionType(params.transactionType),
        gatewayPagamento: 'TEF Stone',
        valorRecebido: 0,
        origemTransacao: OrigemTransacao.HOSPEDAGEM,
    });

    await HistoricoTransacao.create({
        idTransacao: transacao.id,
        idUsuario: params.idUsuario,
        data: dataTransacao,
        descricao: 'Transação criada com sucesso. (Receber Saldo Hospedagem)',
    });

    return transacao;
}

async function marcarTransacaoReceberSaldoAprovada(params: {
    idTransacao: number;
    valor: number;
    payment_uniqueid: string;
    idUsuario: number;
}) {
    const transacao = await Transacao.findByPk(params.idTransacao);
    if (!transacao) return;

    const valorRecebido = roundMoney(
        toNumber(transacao.valorRecebido ?? 0) + Number(params.valor)
    );
    const valorTotal = roundMoney(toNumber(transacao.valorTotal));
    const quitada = Math.round(valorRecebido * 100) >= Math.round(valorTotal * 100);

    await transacao.update({
        valorTaxaProcessamento: 0,
        valorRecebido,
        idTransacaoRecebidoMP: params.payment_uniqueid,
        gatewayPagamento: 'TEF Stone',
        ...(quitada
            ? { status: 'Pago' as const, dataPagamento: new Date() }
            : {}),
    });

    await HistoricoTransacao.create({
        idTransacao: params.idTransacao,
        idUsuario: params.idUsuario,
        data: new Date(),
        descricao: `Pagamento Realizado via POS (Hospedagem): ${params.payment_uniqueid}`,
    });
}

async function marcarTransacaoReceberSaldoCancelada(params: {
    idTransacao: number;
    idUsuario: number;
    payment_uniqueid: string;
}) {
    const transacao = await Transacao.findByPk(params.idTransacao);
    if (!transacao) return;
    if (String(transacao.status) === 'Pago') return;

    await transacao.update({ status: 'Cancelado' });
    await HistoricoTransacao.create({
        idTransacao: params.idTransacao,
        idUsuario: params.idUsuario,
        data: new Date(),
        descricao: `Pagamento POS cancelado (Hospedagem): ${params.payment_uniqueid}`,
    });
}

/**
 * Gravação final exclusiva da hospedagem
 * (equivalente ao que o PDV faz em Transacao/TransacaoPagamento/transacaoPaga).
 */
export async function registrarPagamentoHospedagem(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    pagamento: PagamentoRecepcaoInput;
}) {
    const { idReservaHospedagem, idUsuario, pagamento } = params;
    const reserva = await carregarReservaAutorizada(
        idReservaHospedagem,
        idUsuario
    );
    const atual = resolverSaldoAtual(reserva);

    if (atual.saldoPendente <= 0.009) {
        throw new CustomError(
            'Esta reserva não possui saldo pendente.',
            400,
            ''
        );
    }
    if (!pagamento || pagamento.valor <= 0) {
        throw new CustomError(
            'Informe um valor maior que zero para receber o saldo.',
            400,
            ''
        );
    }
    if (pagamento.valor > atual.saldoPendente + 0.009) {
        throw new CustomError(
            'O valor recebido não pode ser maior que o saldo pendente.',
            400,
            ''
        );
    }
    if (!isFormaPagamentoRecepcao(pagamento.formaPagamento)) {
        throw new CustomError('Forma de pagamento inválida.', 400, '');
    }

    if (pagamento.comprovante) {
        const dup = await PagamentoHospedagem.findOne({
            where: {
                idReservaHospedagem,
                comprovante: pagamento.comprovante,
            },
        });
        if (dup) {
            return {
                reserva: await obterReservaAdminDetalhe(
                    idReservaHospedagem,
                    idUsuario
                ),
                quitada: resolverSaldoAtual(
                    (await ReservaHospedagem.findByPk(idReservaHospedagem)) as ReservaHospedagem
                ).saldoPendente <= 0.009,
            };
        }
    }

    const agora = new Date();
    const novoValorPago = roundMoney(atual.valorPago + pagamento.valor);
    const novoSaldo = calcularSaldoPendente(atual.valorTotal, novoValorPago);

    await connection.transaction(async (t: Transaction) => {
        await PagamentoHospedagem.create(
            {
                idReservaHospedagem: reserva.id,
                valor: pagamento.valor,
                dataPagamento: agora,
                formaPagamento: pagamento.formaPagamento,
                comprovante: pagamento.comprovante ?? null,
                observacao: pagamento.observacao ?? null,
                idUsuario,
            },
            { transaction: t }
        );

        await reserva.update(
            {
                valorPago: novoValorPago,
                saldoPendente: novoSaldo,
                formaPagamentoRecepcao: pagamento.formaPagamento,
                comprovantePagamento: pagamento.comprovante ?? null,
                observacaoPagamento: pagamento.observacao ?? null,
            },
            { transaction: t }
        );
    });

    return {
        reserva: await obterReservaAdminDetalhe(idReservaHospedagem, idUsuario),
        quitada: novoSaldo <= 0.009,
    };
}

/** Réplica de pagamentoDinheiro do PDV → grava só hospedagem. */
export async function receberSaldoDinheiro(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    valorTotal: number;
    observacao?: string | null;
}) {
    const valor = roundMoney(Number(params.valorTotal));
    const registrado = await registrarPagamentoHospedagem({
        idReservaHospedagem: params.idReservaHospedagem,
        idUsuario: params.idUsuario,
        pagamento: {
            valor,
            formaPagamento: 'Dinheiro',
            comprovante: null,
            observacao: params.observacao ?? null,
        },
    });

    // Mesmo shape de retorno do PDV (pagamentoDinheiro).
    return {
        data: {
            payment_uniqueid: 0,
            payment_status: 4,
            payment_message: registrado.quitada
                ? 'Pagamento realizado em Dinheiro'
                : 'Parcial',
            created_at: new Date().toISOString(),
        },
        reserva: registrado.reserva,
    };
}

export async function receberSaldoManual(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    pagamentoRaw: unknown;
}) {
    const pagamento = parsePagamentoRecepcao(params.pagamentoRaw);
    if (!pagamento || pagamento.valor <= 0) {
        throw new CustomError(
            'Informe um valor maior que zero para receber o saldo.',
            400,
            ''
        );
    }
    if (
        pagamento.formaPagamento !== 'Transferencia' &&
        pagamento.formaPagamento !== 'LinkPagamento' &&
        pagamento.formaPagamento !== 'Outro'
    ) {
        throw new CustomError(
            'Este endpoint aceita apenas Transferência, Link de Pagamento ou Outro.',
            400,
            ''
        );
    }
    const registrado = await registrarPagamentoHospedagem({
        idReservaHospedagem: params.idReservaHospedagem,
        idUsuario: params.idUsuario,
        pagamento,
    });
    return registrado.reserva;
}

/**
 * Réplica exata da sequência de PagamentoController.pagamentoPos,
 * trocando apenas a persistência (TransacaoPagamento → HospedagemPagamentoOperacao).
 */
export async function iniciarPagamentoTefHospedagem(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    valorTotal: number;
    transaction_type: number;
    observacao?: string | null;
}) {
    const reserva = await carregarReservaAutorizada(
        params.idReservaHospedagem,
        params.idUsuario
    );
    const atual = resolverSaldoAtual(reserva);
    const valorTotal = roundMoney(Number(params.valorTotal));
    const transactionType = Number(params.transaction_type);

    if (!(valorTotal > 0)) {
        throw new CustomError(
            'Informe um valor maior que zero para receber o saldo.',
            400,
            ''
        );
    }
    if (valorTotal > atual.saldoPendente + 0.009) {
        throw new CustomError(
            'O valor recebido não pode ser maior que o saldo pendente.',
            400,
            ''
        );
    }

    const formaPagamento = formaPorTransactionType(transactionType);

    /**
     * Mesma busca do PagamentoController.pagamentoPos:
     * ProdutorAcesso.findOne({ idUsuario: idUsuarioPDV, tipoAcesso: PDV })
     * idUsuario aqui deve ser o idUsuarioPDV enviado pelo cliente (igual ao PDV).
     */
    const idUsuarioPDV = Number(params.idUsuario);
    const usuario = await ProdutorAcesso.findOne({
        where: { idUsuario: idUsuarioPDV, tipoAcesso: TipoAcesso.PDV },
    });
    if (!usuario) {
        // Mesma mensagem do PagamentoPDV.
        throw new CustomError('ProdutorAcesso não encontrado', 404, '');
    }

    // 1) Mesma arquitetura dos ingressos: Transacao gera o ID usado como order_id.
    const idEvento = Number(reserva.idEvento ?? reserva.Evento?.id);
    if (!(idEvento > 0)) {
        throw new CustomError(
            'Reserva sem evento vinculado para criar a Transação.',
            400,
            ''
        );
    }

    const transacao = await criarTransacaoReceberSaldoHospedagem({
        idUsuario: idUsuarioPDV,
        idEvento,
        valorTotal,
        transactionType,
    });
    const orderIdSuperTef = String(transacao.id);

    // 2) Mesmo payload SuperTEF do PagamentoPDV — order_id = Transacao.id.
    const posData = JSON.stringify({
        cliente_chave: usuario.cliente_chavePOS,
        pos_id: usuario.pos_id,
        transaction_type: transactionType,
        installment_count: 1,
        amount: Number(valorTotal),
        order_id: orderIdSuperTef,
        description: 'Pagamento de Hospedagem',
        installment_type: 1,
    });

    const config = {
        method: 'post' as const,
        url: 'https://api.supertef.com.br/api/pagamentos',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SuperTefBearerToken}`,
        },
        data: posData,
    };

    let result: { payment_uniqueid?: string | number };
    try {
        const response = await axios(config);
        result = response.data;
    } catch (error) {
        console.error('Erro ao criar pagamento POS hospedagem:', error);
        await marcarTransacaoReceberSaldoCancelada({
            idTransacao: transacao.id,
            idUsuario: idUsuarioPDV,
            payment_uniqueid: 'falha-inicio-supertef',
        });
        throw new CustomError('Erro ao gerar pagamento Pix', 500, '');
    }

    // 3) Operação local da hospedagem com o mesmo order_id (Transacao.id).
    await HospedagemPagamentoOperacao.create({
        uuid: randomUUID(),
        tipo: HospedagemPagamentoOperacaoTipo.HOSPEDAGEM,
        origem: HospedagemPagamentoOperacaoOrigem.RECEBER_SALDO,
        idReservaHospedagem: reserva.id,
        idUsuario: params.idUsuario,
        valor: valorTotal,
        formaPagamento,
        status: HospedagemPagamentoOperacaoStatus.ENVIADO_PINPAD,
        orderIdSuperTef,
        idExternoSuperTef: result.payment_uniqueid?.toString() || '',
        observacao: params.observacao ?? null,
        mensagemStatus: 'pending',
        rawInicio: JSON.stringify(result || {}),
    });

    // Mesmo retorno do PDV.
    return {
        id: result.payment_uniqueid,
        status: 'pending',
    };
}

/**
 * Réplica de PagamentoController.consultaPagamentoPos.
 * status 4 → atualiza Transacao (order_id) + PagamentoHospedagem + ReservaHospedagem.
 * Não chama transacaoPaga (evita efeitos colaterais em ingressos).
 */
export async function consultarPagamentoTefHospedagem(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    payment_uniqueid: string;
}) {
    const payment_uniqueid = String(params.payment_uniqueid || '').trim();
    if (!payment_uniqueid) {
        throw new CustomError('Tipo de POS não suportado', 400, '');
    }

    await carregarReservaAutorizada(
        params.idReservaHospedagem,
        params.idUsuario
    );

    let statusTransacao = 'Pendente';
    let reservaDetalhe = null;

    const config = {
        method: 'get' as const,
        url: `https://api.supertef.com.br/api/pagamentos/by-uniqueid/${payment_uniqueid}?payment_uniqueid`,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SuperTefBearerToken}`,
        },
    };

    let data: Record<string, unknown>;
    try {
        const response = await axios(config);
        data = response.data || {};
        console.log('Dados do pagamento (hospedagem):', data);
    } catch (error) {
        console.error('Erro ao processar POS hospedagem:', error);
        throw new CustomError('Erro ao processar POS', 500, '');
    }

    if (Number(data.payment_status) === 4) {
        // Equivalente a TransacaoPagamento.findOne({ PagamentoCodigo, gateway TEF Stone })
        const operacao = await HospedagemPagamentoOperacao.findOne({
            where: {
                idReservaHospedagem: params.idReservaHospedagem,
                idExternoSuperTef: payment_uniqueid,
            },
            order: [['id', 'DESC']],
        });

        if (operacao) {
            if (
                operacao.status === HospedagemPagamentoOperacaoStatus.REGISTRADO
            ) {
                statusTransacao = 'Pago';
                reservaDetalhe = await obterReservaAdminDetalhe(
                    params.idReservaHospedagem,
                    params.idUsuario
                );
                const saldo = Number(
                    (reservaDetalhe as { saldoPendente?: number })
                        ?.saldoPendente ?? 0
                );
                if (saldo > 0.009) statusTransacao = 'Parcial';
            } else {
                const valorOp = roundMoney(toNumber(operacao.valor));
                const idTransacaoOp = Number(operacao.orderIdSuperTef);

                // Atualiza a Transacao geradora do order_id (sem chamar transacaoPaga / ingressos).
                if (Number.isFinite(idTransacaoOp) && idTransacaoOp > 0) {
                    await marcarTransacaoReceberSaldoAprovada({
                        idTransacao: idTransacaoOp,
                        valor: valorOp,
                        payment_uniqueid,
                        idUsuario: operacao.idUsuario,
                    });
                }

                const registrado = await registrarPagamentoHospedagem({
                    idReservaHospedagem: operacao.idReservaHospedagem,
                    idUsuario: operacao.idUsuario,
                    pagamento: {
                        valor: valorOp,
                        formaPagamento:
                            operacao.formaPagamento as FormaPagamentoRecepcao,
                        comprovante:
                            comprovantePorPaymentUniqueId(payment_uniqueid),
                        observacao: operacao.observacao ?? null,
                    },
                });

                await operacao.update({
                    status: HospedagemPagamentoOperacaoStatus.REGISTRADO,
                    mensagemStatus: registrado.quitada ? 'Pago' : 'Parcial',
                });

                // Paralelo ao PDV: Pago se quitou; Parcial se ainda há saldo.
                statusTransacao = registrado.quitada ? 'Pago' : 'Parcial';
                reservaDetalhe = registrado.reserva;
            }
        }
    }

    // Mesmo shape do PDV.
    return {
        data: {
            ...data,
            payment_message:
                statusTransacao !== 'Pendente'
                    ? statusTransacao
                    : data.payment_message,
        },
        reserva: reservaDetalhe,
    };
}

/** Réplica de PagamentoController.cancelaPagamentoPos. */
export async function cancelarPagamentoTefHospedagem(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    payment_uniqueid: string;
}) {
    const payment_uniqueid = String(params.payment_uniqueid || '').trim();
    if (!payment_uniqueid) {
        throw new CustomError('Tipo de POS não suportado', 400, '');
    }

    await carregarReservaAutorizada(
        params.idReservaHospedagem,
        params.idUsuario
    );

    const config = {
        method: 'put' as const,
        url: `https://api.supertef.com.br/api/pagamentos/cancelar/${payment_uniqueid}`,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SuperTefBearerToken}`,
        },
    };

    let data: Record<string, unknown>;
    try {
        const response = await axios(config);
        data = response.data || {};
        console.log('Dados do cancelamento (hospedagem):', data);
    } catch (error) {
        console.error('Erro ao processar POS hospedagem:', error);
        throw new CustomError('Erro ao processar POS', 500, '');
    }

    const operacao = await HospedagemPagamentoOperacao.findOne({
        where: {
            idReservaHospedagem: params.idReservaHospedagem,
            idExternoSuperTef: payment_uniqueid,
        },
        order: [['id', 'DESC']],
    });

    if (operacao) {
        await operacao.update({
            status: HospedagemPagamentoOperacaoStatus.CANCELADO,
            mensagemStatus: 'Cancelado/erro',
        });

        const idTransacaoOp = Number(operacao.orderIdSuperTef);
        if (Number.isFinite(idTransacaoOp) && idTransacaoOp > 0) {
            await marcarTransacaoReceberSaldoCancelada({
                idTransacao: idTransacaoOp,
                idUsuario: params.idUsuario,
                payment_uniqueid,
            });
        }
    }

    return { data };
}

/** Compat: finalizar = consultar (como o PDV efetiva na consulta). */
export async function finalizarPagamentoTefHospedagem(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    payment_uniqueid: string;
}) {
    return consultarPagamentoTefHospedagem(params);
}
