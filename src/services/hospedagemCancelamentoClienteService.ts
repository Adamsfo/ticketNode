import { QueryTypes, Transaction } from 'sequelize';
import connection from '../database';
import {
    PagamentoHospedagem,
    type FormaPagamentoRecepcao,
} from '../models/PagamentoHospedagem';
import {
    ReservaHospedagem,
    StatusReservaHospedagem,
} from '../models/ReservaHospedagem';
import { CustomError } from '../utils/customError';
import { calcularSaldoPendente } from '../utils/hospedagemPagamentoRecepcao';
import {
    avaliarElegibilidadeCancelamentoCliente,
    calcularPoliticaDevolucaoCliente,
    type ElegibilidadeCancelamentoCliente,
    type PagamentoHospedagemResumo,
} from './hospedagemCancelamentoClientePolicy';
import { executarEstornosMercadoPagoHospedagem } from './hospedagemEstornoMercadoPagoService';
import {
    assertUsuarioDonoReservaPublica,
    cancelarReservaHospedagem,
} from './reservaSuiteService';

const LOCK_TIMEOUT_SEGUNDOS = 30;

export type CancelamentoClienteDto = {
    podeCancelar: boolean;
    motivoBloqueio: string | null;
    percentualDevolucao: 50 | 100 | null;
    valorDevolucao: number | null;
    valorPago: number;
    valorPagoMercadoPago: number;
    valorEstornado: number;
    requerEstornoManual: boolean;
};

export type ResultadoCancelamentoCliente = {
    id: number;
    status: string;
    numeroReserva: number;
    valorPago: number;
    percentualDevolucao: 50 | 100;
    valorDevolucao: number;
    valorEstornado: number;
    estornosMercadoPago: Array<{
        paymentId: string;
        amount: number;
        refundId?: number;
        status?: string;
    }>;
};

function toNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

function mapearPagamentos(
    pagamentos: PagamentoHospedagem[]
): PagamentoHospedagemResumo[] {
    return pagamentos.map((item) => ({
        id: item.id,
        valor: toNumber(item.valor),
        formaPagamento: item.formaPagamento as FormaPagamentoRecepcao,
        comprovante: item.comprovante ?? null,
    }));
}

export function montarCancelamentoClienteDto(
    reserva: ReservaHospedagem,
    pagamentos: PagamentoHospedagemResumo[],
    agora?: Date
): CancelamentoClienteDto {
    const elegibilidade = avaliarElegibilidadeCancelamentoCliente({
        reserva,
        pagamentos,
        agora,
    });

    return {
        podeCancelar: elegibilidade.podeCancelar,
        motivoBloqueio: elegibilidade.motivoBloqueio,
        percentualDevolucao: elegibilidade.percentualDevolucao,
        valorDevolucao: elegibilidade.valorDevolucao,
        valorPago: roundMoney(toNumber(reserva.valorPago ?? 0)),
        valorPagoMercadoPago: elegibilidade.valorPagoMercadoPago,
        valorEstornado: 0,
        requerEstornoManual: elegibilidade.requerEstornoManual,
    };
}

async function adquirirLockCancelamentoCliente(
    idReserva: number,
    transaction: Transaction
): Promise<void> {
    const lockName = `cancelamento_cliente_reserva_${idReserva}`;
    const rows = (await connection.query(
        'SELECT GET_LOCK(:lockName, :timeout) AS acquired',
        {
            replacements: {
                lockName,
                timeout: LOCK_TIMEOUT_SEGUNDOS,
            },
            type: QueryTypes.SELECT,
            transaction,
        }
    )) as Array<{ acquired?: number | null }>;

    const acquired = Number(rows[0]?.acquired ?? 0);
    if (acquired !== 1) {
        throw new CustomError(
            'Não foi possível processar o cancelamento agora. Tente novamente.',
            409,
            ''
        );
    }
}

async function liberarLockCancelamentoCliente(
    idReserva: number,
    transaction: Transaction
): Promise<void> {
    const lockName = `cancelamento_cliente_reserva_${idReserva}`;
    await connection.query('SELECT RELEASE_LOCK(:lockName)', {
        replacements: { lockName },
        type: QueryTypes.SELECT,
        transaction,
    });
}

async function carregarReservaParaCancelamentoCliente(
    idReserva: number,
    idUsuarioJwt: number
) {
    const reserva = await ReservaHospedagem.findByPk(idReserva);
    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    assertUsuarioDonoReservaPublica(reserva, idUsuarioJwt);

    const pagamentos = await PagamentoHospedagem.findAll({
        where: { idReservaHospedagem: idReserva },
        order: [['id', 'ASC']],
    });

    return {
        reserva,
        pagamentos: mapearPagamentos(pagamentos),
    };
}

function validarElegibilidadeOuErro(
    elegibilidade: ElegibilidadeCancelamentoCliente
): void {
    if (!elegibilidade.podeCancelar) {
        throw new CustomError(
            elegibilidade.motivoBloqueio ||
                'Esta reserva não pode ser cancelada pelo cliente.',
            400,
            ''
        );
    }
}

export async function obterPoliticaCancelamentoCliente(
    idReserva: number,
    idUsuarioJwt: number,
    agora?: Date
): Promise<CancelamentoClienteDto> {
    const { reserva, pagamentos } = await carregarReservaParaCancelamentoCliente(
        idReserva,
        idUsuarioJwt
    );
    return montarCancelamentoClienteDto(reserva, pagamentos, agora);
}

export async function cancelarMinhaReservaHospedagem(
    idReserva: number,
    idUsuarioJwt: number,
    agora: Date = new Date()
): Promise<ResultadoCancelamentoCliente> {
    const id = Number(idReserva);
    const idUsuario = Number(idUsuarioJwt);

    if (!Number.isFinite(id) || id <= 0) {
        throw new CustomError('id da reserva é obrigatório.', 400, '');
    }
    if (!Number.isFinite(idUsuario) || idUsuario <= 0) {
        throw new CustomError('Usuário não autenticado.', 401, '');
    }

    const { reserva: reservaInicial, pagamentos } =
        await carregarReservaParaCancelamentoCliente(id, idUsuario);

    if (reservaInicial.status === StatusReservaHospedagem.Cancelada) {
        throw new CustomError('Esta reserva já está cancelada.', 400, '');
    }

    const elegibilidade = avaliarElegibilidadeCancelamentoCliente({
        reserva: reservaInicial,
        pagamentos,
        agora,
    });
    validarElegibilidadeOuErro(elegibilidade);

    const politica = calcularPoliticaDevolucaoCliente({
        checkin: reservaInicial.checkin,
        valorPago: toNumber(reservaInicial.valorPago ?? 0),
        agora,
    });

    let estornosExecutados: Awaited<
        ReturnType<typeof executarEstornosMercadoPagoHospedagem>
    > = [];
    let valorPagoAtual = roundMoney(toNumber(reservaInicial.valorPago ?? 0));
    let valorEstornado = 0;

    await connection.transaction(async (transaction: Transaction) => {
        await adquirirLockCancelamentoCliente(id, transaction);

        try {
            const reservaLocked = await ReservaHospedagem.findByPk(id, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });

            if (!reservaLocked) {
                throw new CustomError(
                    'Reserva de hospedagem não encontrada.',
                    404,
                    ''
                );
            }

            assertUsuarioDonoReservaPublica(reservaLocked, idUsuario);

            if (reservaLocked.status === StatusReservaHospedagem.Cancelada) {
                throw new CustomError('Esta reserva já está cancelada.', 400, '');
            }

            const elegibilidadeLocked = avaliarElegibilidadeCancelamentoCliente({
                reserva: reservaLocked,
                pagamentos,
                agora,
            });
            validarElegibilidadeOuErro(elegibilidadeLocked);

            if (elegibilidadeLocked.valorDevolucaoMercadoPago > 0.009) {
                estornosExecutados =
                    await executarEstornosMercadoPagoHospedagem({
                        idEvento: Number(reservaLocked.idEvento),
                        idTransacaoPrincipal: reservaLocked.idTransacao ?? null,
                        idTransacaoHistorico: reservaLocked.idTransacao ?? null,
                        idUsuario,
                        pagamentos,
                        valorEstornoTotal:
                            elegibilidadeLocked.valorDevolucaoMercadoPago,
                    });
            }

            valorEstornado = roundMoney(
                estornosExecutados.reduce((acc, item) => acc + item.amount, 0)
            );
            valorPagoAtual = roundMoney(toNumber(reservaLocked.valorPago ?? 0));
            const novoValorPago = roundMoney(
                Math.max(0, valorPagoAtual - valorEstornado)
            );
            const valorTotal = roundMoney(toNumber(reservaLocked.valorTotal));
            const novoSaldo = calcularSaldoPendente(valorTotal, novoValorPago);

            if (valorEstornado > 0.009) {
                await reservaLocked.update(
                    {
                        valorPago: novoValorPago,
                        saldoPendente: novoSaldo,
                    },
                    { transaction }
                );
            }

            await cancelarReservaHospedagem(
                id,
                idUsuario,
                `[CancelamentoCliente] Reserva cancelada pelo cliente. Devolução ${politica.percentualDevolucao}% sobre valor pago (R$ ${politica.valorDevolucao.toFixed(2)}). Estornado via Mercado Pago: R$ ${valorEstornado.toFixed(2)}.`,
                { transaction, omitirSideEffects: true }
            );
        } finally {
            await liberarLockCancelamentoCliente(id, transaction);
        }
    });

    const { incrementarHospedagemRefreshVersion } = await import(
        './hospedagemRefreshVersionService'
    );
    await incrementarHospedagemRefreshVersion();

    const { markOutboundCancelled } = await import(
        '../integrations/hospedin/outbound/HospedinOutboundEnqueueService'
    );
    await markOutboundCancelled(id);

    return {
        id,
        status: StatusReservaHospedagem.Cancelada,
        numeroReserva: id,
        valorPago: valorPagoAtual,
        percentualDevolucao: politica.percentualDevolucao,
        valorDevolucao: politica.valorDevolucao,
        valorEstornado,
        estornosMercadoPago: estornosExecutados.map((item) => ({
            paymentId: item.paymentId,
            amount: item.amount,
            refundId: item.refundId,
            status: item.status,
        })),
    };
}
