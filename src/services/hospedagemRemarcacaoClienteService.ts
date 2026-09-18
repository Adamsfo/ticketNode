import { Op, QueryTypes, Transaction } from 'sequelize';
import { formatInTimeZone } from 'date-fns-tz';
import connection from '../database';
import { Evento } from '../models/Evento';
import { EventoSuite } from '../models/EventoSuite';
import {
    ReservaHospedagem,
    StatusReservaHospedagem,
} from '../models/ReservaHospedagem';
import { ReservaHospedagemTaxaAdicional } from '../models/ReservaHospedagemTaxaAdicional';
import { ReservaSuite, StatusReservaSuite } from '../models/ReservaSuite';
import {
    ReservaPeriodoMovimentacao,
    TipoMovimentacaoPeriodo,
} from '../models/ReservaPeriodoMovimentacao';
import { HistoricoTransacao } from '../models/Transacao';
import { CustomError } from '../utils/customError';
import {
    calcularNoitesHotelaria,
    normalizarPeriodoHospedagem,
    toNumber,
    validarCapacidadeMaximaPousada,
} from '../utils/reservaSuiteUtils';
import { roundMoney } from '../utils/reservaSuitePricing';
import { calcularSaldoPendente } from '../utils/hospedagemPagamentoRecepcao';
import {
    calcularDisponibilidadePeriodo,
    SUITE_DISPONIBILIDADE_TZ,
    type ReservaDisponibilidadeInput,
    type StatusReservaDisponibilidade,
} from './suiteDisponibilidadeService';
import { recalcularFinanceiroReservaComServicos } from './reservaSuiteFinanceiroService';
import { assertUsuarioDonoReservaPublica } from './reservaSuiteService';
import {
    avaliarElegibilidadeRemarcacaoCliente,
    DESCRICAO_TAXA_REMARCACAO,
    ESTADO_REMARCACAO_CONCLUIDA,
    ESTADO_REMARCACAO_PENDENTE,
    isHistoricoRemarcacaoConcluida,
    MARCA_REMARCACAO_CLIENTE,
    montarHistoricoRemarcacaoConcluida,
    montarHistoricoRemarcacaoPendente,
    parseHistoricoRemarcacaoPendente,
    TAXA_REMARCACAO_CLIENTE,
    type RemarcacaoPendenteHistorico,
} from './hospedagemRemarcacaoClientePolicy';

const LOCK_TIMEOUT_SEGUNDOS = 30;
const TZ = SUITE_DISPONIBILIDADE_TZ;

const STATUS_RESERVA_SUITE_OCUPA = [
    StatusReservaSuite.Confirmada,
    StatusReservaSuite.Hospedada,
    StatusReservaSuite.AguardandoPagamento,
];

export type RemarcacaoClienteDto = {
    podeRemarcar: boolean;
    motivoBloqueio: string | null;
    horasRestantes: number | null;
    taxaRemarcacao: number | null;
    taxaPlataforma: number | null;
    taxaJango: number | null;
    remarcacaoPendente: RemarcacaoPendenteDto | null;
};

export type PixRemarcacaoPendenteDto = {
    paymentId: string;
    status?: string;
    reutilizado: boolean;
};

export type RemarcacaoPendenteDto = {
    idTaxa: number;
    valorPagamento: number;
    saldoPendente: number;
    dataCheckInNova: string;
    dataCheckOutNova: string;
    pixPendente?: PixRemarcacaoPendenteDto | null;
};

export type ResultadoRemarcacaoCliente = {
    reservaId: number;
    remarcada: boolean;
    aguardandoPagamento?: boolean;
    taxa: number;
    valorPagamento?: number;
    valorPago: number;
    saldoPendente: number;
    dataCheckInAnterior: string;
    dataCheckOutAnterior: string;
    dataCheckInNova: string;
    dataCheckOutNova: string;
    idTaxa?: number;
    idTransacao?: number;
};

type ReservaRemarcacaoIncludes = ReservaHospedagem & {
    Evento?: { id: number; idProdutor?: number } | null;
    ReservaSuite?: Array<
        ReservaSuite & {
            EventoSuite?: {
                id: number;
                nome?: string;
                status?: string;
                qtdeMinimaPessoas?: number;
                qtdeMaximaPessoas?: number;
            } | null;
        }
    >;
};

async function adquirirLockRemarcacaoCliente(
    idReserva: number,
    transaction: Transaction
): Promise<void> {
    const lockName = `remarcacao_cliente_reserva_${idReserva}`;
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
            'Não foi possível processar a remarcação agora. Tente novamente.',
            409,
            ''
        );
    }
}

async function carregarReservasParaDisponibilidade(
    idEventoSuite: number,
    excludeReservaHospedagemId: number
): Promise<ReservaDisponibilidadeInput[]> {
    const ocupantes = await ReservaSuite.findAll({
        where: {
            idEventoSuite,
            status: { [Op.in]: STATUS_RESERVA_SUITE_OCUPA },
        },
        include: [
            {
                model: ReservaHospedagem,
                as: 'ReservaHospedagem',
                required: true,
            },
        ],
    });

    const out: ReservaDisponibilidadeInput[] = [];
    for (const linha of ocupantes) {
        if (Number(linha.idReservaHospedagem) === Number(excludeReservaHospedagemId)) {
            continue;
        }
        const hospedagem = (linha as ReservaSuite & {
            ReservaHospedagem?: ReservaHospedagem;
        }).ReservaHospedagem;
        if (!hospedagem) continue;
        out.push({
            id: hospedagem.id,
            status: hospedagem.status as StatusReservaDisponibilidade,
            checkin: hospedagem.checkin,
            checkout: hospedagem.checkout,
            dataHoraCheckinReal:
                (hospedagem as ReservaHospedagem & {
                    dataHoraCheckinReal?: Date | null;
                }).dataHoraCheckinReal ?? null,
            dataHoraCheckoutRealizado:
                (hospedagem as ReservaHospedagem & {
                    dataHoraCheckoutRealizado?: Date | null;
                }).dataHoraCheckoutRealizado ?? null,
            saldoPendente: toNumber(
                (hospedagem as ReservaHospedagem & { saldoPendente?: number })
                    .saldoPendente ?? 0
            ),
        });
    }
    return out;
}

export async function validarDisponibilidadeRemarcacao(
    reserva: ReservaRemarcacaoIncludes,
    checkinNovo: Date,
    checkoutNovo: Date
): Promise<void> {
    const linhas = reserva.ReservaSuite ?? [];
    if (!linhas.length) {
        throw new CustomError('Reserva sem suíte vinculada.', 400, '');
    }

    const hojeStr = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
    const dataCiNovo = formatInTimeZone(checkinNovo, TZ, 'yyyy-MM-dd');

    for (const linha of linhas) {
        const suite = linha.EventoSuite;
        if (!suite) {
            throw new CustomError(
                `Suíte ${linha.idEventoSuite} não está disponível.`,
                400,
                ''
            );
        }
        // Suíte já vinculada à reserva: disponibilidade é pelo período, não pelo status cadastral (Oculto/PDV).

        validarCapacidadeMaximaPousada(
            Number(linha.adultos || 0),
            Number(linha.criancas || 0),
            suite.qtdeMaximaPessoas,
            suite.qtdeMinimaPessoas
        );

        const reservas = await carregarReservasParaDisponibilidade(
            suite.id,
            reserva.id
        );

        const disp = calcularDisponibilidadePeriodo({
            idEventoSuite: suite.id,
            checkin: checkinNovo,
            checkout: checkoutNovo,
            reservas,
        });

        if (disp.conflitoPeriodo) {
            throw new CustomError(
                `Suíte indisponível no período: ${suite.nome}.`,
                409,
                ''
            );
        }

        if (dataCiNovo >= hojeStr) {
            if (!disp.disponibilidadeNoDiaCheckin.podeReservar) {
                throw new CustomError(
                    `Suíte indisponível no período: ${suite.nome}.`,
                    409,
                    ''
                );
            }
        }
    }
}

async function carregarReservaRemarcacao(
    idReserva: number
): Promise<ReservaRemarcacaoIncludes> {
    const reserva = (await ReservaHospedagem.findByPk(idReserva, {
        include: [
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'idProdutor'],
                required: false,
            },
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                required: false,
                include: [
                    {
                        model: EventoSuite,
                        as: 'EventoSuite',
                        attributes: [
                            'id',
                            'nome',
                            'status',
                            'qtdeMinimaPessoas',
                            'qtdeMaximaPessoas',
                        ],
                        required: false,
                    },
                ],
            },
        ],
    })) as ReservaRemarcacaoIncludes | null;

    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    return reserva;
}

export async function buscarRemarcacaoPendentePorReserva(
    idReserva: number
): Promise<RemarcacaoPendenteHistorico | null> {
    const reserva = await ReservaHospedagem.findByPk(idReserva, {
        attributes: ['id', 'idTransacao'],
    });
    if (!reserva?.idTransacao) {
        return null;
    }

    const historicos = await HistoricoTransacao.findAll({
        where: {
            idTransacao: reserva.idTransacao,
            descricao: { [Op.like]: `${MARCA_REMARCACAO_CLIENTE}|${ESTADO_REMARCACAO_PENDENTE}%` },
        },
        order: [['id', 'DESC']],
        limit: 20,
    });

    for (const historico of historicos) {
        const pendente = parseHistoricoRemarcacaoPendente(historico.descricao);
        if (!pendente || pendente.idReserva !== idReserva) {
            continue;
        }

        const concluida = await HistoricoTransacao.findOne({
            where: {
                idTransacao: reserva.idTransacao,
                descricao: montarHistoricoRemarcacaoConcluida(pendente.idTaxa),
            },
        });
        if (concluida) {
            continue;
        }

        const taxa = await ReservaHospedagemTaxaAdicional.findOne({
            where: { id: pendente.idTaxa, idReservaHospedagem: idReserva },
        });
        if (!taxa) {
            continue;
        }

        return { ...pendente, idHistorico: historico.id };
    }

    return null;
}

export function montarRemarcacaoClienteDto(
    reserva: ReservaHospedagem,
    pendente: RemarcacaoPendenteHistorico | null,
    agora?: Date,
    pixPendente?: PixRemarcacaoPendenteDto | null
): RemarcacaoClienteDto {
    const elegibilidade = avaliarElegibilidadeRemarcacaoCliente({
        reserva,
        agora,
    });

    const valorTotal = toNumber(reserva.valorTotal);
    const valorPago = toNumber(reserva.valorPago ?? 0);
    const saldoPendente =
        reserva.saldoPendente != null
            ? toNumber(reserva.saldoPendente)
            : calcularSaldoPendente(valorTotal, valorPago);

    let remarcacaoPendente: RemarcacaoPendenteDto | null = null;
    if (pendente) {
        remarcacaoPendente = {
            idTaxa: pendente.idTaxa,
            valorPagamento: TAXA_REMARCACAO_CLIENTE,
            saldoPendente: roundMoney(saldoPendente),
            dataCheckInNova: pendente.checkin.toISOString(),
            dataCheckOutNova: pendente.checkout.toISOString(),
            pixPendente: pixPendente ?? null,
        };
    }

    return {
        podeRemarcar: elegibilidade.podeRemarcar || Boolean(remarcacaoPendente),
        motivoBloqueio: remarcacaoPendente
            ? null
            : elegibilidade.motivoBloqueio,
        horasRestantes: elegibilidade.horasRestantes,
        taxaRemarcacao: elegibilidade.taxaRemarcacao,
        taxaPlataforma: elegibilidade.taxaPlataforma,
        taxaJango: elegibilidade.taxaJango,
        remarcacaoPendente,
    };
}

async function proximaOrdemTaxa(
    idReservaHospedagem: number,
    transaction: Transaction
): Promise<number> {
    const maxOrdem = await ReservaHospedagemTaxaAdicional.max('ordem', {
        where: { idReservaHospedagem },
        transaction,
    });
    const atual = Number(maxOrdem ?? 0);
    return atual > 0 ? atual + 1 : 1;
}

export async function alterarPeriodoReservaCliente(params: {
    reserva: ReservaRemarcacaoIncludes;
    idUsuario: number;
    checkin: Date;
    checkout: Date;
    motivo?: string | null;
    transaction?: Transaction;
}): Promise<void> {
    const reserva = params.reserva;
    const checkinNovo = params.checkin;
    const checkoutNovo = params.checkout;

    if (checkoutNovo.getTime() <= checkinNovo.getTime()) {
        throw new CustomError(
            'O check-out deve ser posterior ao check-in.',
            400,
            ''
        );
    }

    const noites = calcularNoitesHotelaria(checkinNovo, checkoutNovo);
    const checkinAnterior = new Date(reserva.checkin);
    const checkoutAnterior = new Date(reserva.checkout);
    const motivo = params.motivo?.trim() || 'Remarcação pelo cliente';
    const agora = new Date();

    const executar = async (t: Transaction) => {
        await ReservaPeriodoMovimentacao.create(
            {
                idReservaHospedagem: reserva.id,
                idUsuario: params.idUsuario,
                dataHora: agora,
                checkinAnterior,
                checkoutAnterior,
                checkinNovo,
                checkoutNovo,
                motivo,
                tipo: TipoMovimentacaoPeriodo.ALTERACAO,
            },
            { transaction: t }
        );

        await reserva.update(
            {
                checkin: checkinNovo,
                checkout: checkoutNovo,
                noites,
            },
            { transaction: t }
        );
    };

    if (params.transaction) {
        await executar(params.transaction);
    } else {
        await connection.transaction(executar);
    }
}

async function notificarAlteracaoPeriodo(idReservaHospedagem: number) {
    const { incrementarHospedagemRefreshVersion } = await import(
        './hospedagemRefreshVersionService'
    );
    await incrementarHospedagemRefreshVersion();

    const { hospedinOutboundEnqueueService } = await import(
        '../integrations/hospedin/outbound/HospedinOutboundEnqueueService'
    );
    await hospedinOutboundEnqueueService.markDirty(idReservaHospedagem);
}

export async function atualizarDatasRemarcacaoPendente(params: {
    idReserva: number;
    idUsuario: number;
    pendente: RemarcacaoPendenteHistorico;
    checkin: Date;
    checkout: Date;
}): Promise<RemarcacaoPendenteHistorico> {
    const reserva = await carregarReservaRemarcacao(params.idReserva);
    assertUsuarioDonoReservaPublica(reserva, params.idUsuario);

    if (params.checkout.getTime() <= params.checkin.getTime()) {
        throw new CustomError(
            'O check-out deve ser posterior ao check-in.',
            400,
            ''
        );
    }

    const checkinAnterior = new Date(reserva.checkin);
    const checkoutAnterior = new Date(reserva.checkout);
    if (
        checkinAnterior.getTime() === params.checkin.getTime() &&
        checkoutAnterior.getTime() === params.checkout.getTime()
    ) {
        throw new CustomError('O período informado é o mesmo da reserva.', 400, '');
    }

    await validarDisponibilidadeRemarcacao(
        reserva,
        params.checkin,
        params.checkout
    );

    if (!reserva.idTransacao || !params.pendente.idHistorico) {
        throw new CustomError(
            'Remarcação pendente sem histórico para atualização.',
            400,
            ''
        );
    }

    const novaDescricao = montarHistoricoRemarcacaoPendente({
        idReserva: params.idReserva,
        idTaxa: params.pendente.idTaxa,
        checkin: params.checkin,
        checkout: params.checkout,
    });

    await connection.transaction(async (t: Transaction) => {
        await adquirirLockRemarcacaoCliente(params.idReserva, t);

        const pendenteAtual = await buscarRemarcacaoPendentePorReserva(
            params.idReserva
        );
        if (
            !pendenteAtual ||
            pendenteAtual.idTaxa !== params.pendente.idTaxa
        ) {
            throw new CustomError(
                'Remarcação pendente não encontrada para atualização.',
                404,
                ''
            );
        }

        await validarDisponibilidadeRemarcacao(
            await carregarReservaRemarcacao(params.idReserva),
            params.checkin,
            params.checkout
        );

        await HistoricoTransacao.update(
            { descricao: novaDescricao },
            {
                where: {
                    id: params.pendente.idHistorico,
                    idTransacao: Number(reserva.idTransacao),
                },
                transaction: t,
            }
        );
    });

    const atualizado = await buscarRemarcacaoPendentePorReserva(params.idReserva);
    if (!atualizado) {
        throw new CustomError(
            'Não foi possível atualizar as datas da remarcação pendente.',
            500,
            ''
        );
    }

    return atualizado;
}

export async function carregarRemarcacoesPendentesPorReservas(
    idsReserva: number[]
): Promise<Map<number, RemarcacaoPendenteHistorico>> {
    const mapa = new Map<number, RemarcacaoPendenteHistorico>();
    if (!idsReserva.length) {
        return mapa;
    }

    await Promise.all(
        idsReserva.map(async (idReserva) => {
            const pendente = await buscarRemarcacaoPendentePorReserva(idReserva);
            if (pendente) {
                mapa.set(idReserva, pendente);
            }
        })
    );

    return mapa;
}

function montarResultadoRemarcacao(
    reserva: ReservaHospedagem,
    params: {
        remarcada: boolean;
        aguardandoPagamento?: boolean;
        taxa: number;
        valorPagamento?: number;
        checkinAnterior: Date;
        checkoutAnterior: Date;
        checkinNovo: Date;
        checkoutNovo: Date;
        idTaxa?: number;
    }
): ResultadoRemarcacaoCliente {
    const valorTotal = toNumber(reserva.valorTotal);
    const valorPago = toNumber(reserva.valorPago ?? 0);
    const saldoPendente =
        reserva.saldoPendente != null
            ? toNumber(reserva.saldoPendente)
            : calcularSaldoPendente(valorTotal, valorPago);

    return {
        reservaId: reserva.id,
        remarcada: params.remarcada,
        aguardandoPagamento: params.aguardandoPagamento,
        taxa: params.taxa,
        valorPagamento: params.valorPagamento,
        valorPago,
        saldoPendente,
        dataCheckInAnterior: params.checkinAnterior.toISOString(),
        dataCheckOutAnterior: params.checkoutAnterior.toISOString(),
        dataCheckInNova: params.checkinNovo.toISOString(),
        dataCheckOutNova: params.checkoutNovo.toISOString(),
        idTaxa: params.idTaxa,
        idTransacao: reserva.idTransacao ?? undefined,
    };
}

export async function remarcarMinhaReservaHospedagem(
    idReserva: number,
    idUsuarioJwt: number,
    body: { dataCheckIn?: unknown; dataCheckOut?: unknown }
): Promise<ResultadoRemarcacaoCliente> {
    const id = Number(idReserva);
    const idUsuario = Number(idUsuarioJwt);

    if (!Number.isFinite(id) || id <= 0) {
        throw new CustomError('id da reserva é obrigatório.', 400, '');
    }
    if (!Number.isFinite(idUsuario) || idUsuario <= 0) {
        throw new CustomError('Usuário não autenticado.', 401, '');
    }

    const reserva = await carregarReservaRemarcacao(id);
    assertUsuarioDonoReservaPublica(reserva, idUsuario);

    let pendenteExistente = await buscarRemarcacaoPendentePorReserva(id);
    if (pendenteExistente) {
        const periodoPendente = normalizarPeriodoHospedagem(
            body.dataCheckIn,
            body.dataCheckOut
        );
        if (periodoPendente.checkin && periodoPendente.checkout) {
            const checkinSolicitado = periodoPendente.checkin;
            const checkoutSolicitado = periodoPendente.checkout;
            const datasAlteradas =
                pendenteExistente.checkin.getTime() !==
                    checkinSolicitado.getTime() ||
                pendenteExistente.checkout.getTime() !==
                    checkoutSolicitado.getTime();

            if (datasAlteradas) {
                pendenteExistente = await atualizarDatasRemarcacaoPendente({
                    idReserva: id,
                    idUsuario,
                    pendente: pendenteExistente,
                    checkin: checkinSolicitado,
                    checkout: checkoutSolicitado,
                });
            }
        }

        const reservaAtual = await ReservaHospedagem.findByPk(id);
        if (!reservaAtual) {
            throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
        }
        return montarResultadoRemarcacao(reservaAtual, {
            remarcada: false,
            aguardandoPagamento: true,
            taxa: TAXA_REMARCACAO_CLIENTE,
            valorPagamento: TAXA_REMARCACAO_CLIENTE,
            checkinAnterior: new Date(reservaAtual.checkin),
            checkoutAnterior: new Date(reservaAtual.checkout),
            checkinNovo: pendenteExistente.checkin,
            checkoutNovo: pendenteExistente.checkout,
            idTaxa: pendenteExistente.idTaxa,
        });
    }

    const elegibilidade = avaliarElegibilidadeRemarcacaoCliente({
        reserva,
        agora: new Date(),
    });
    if (!elegibilidade.podeRemarcar) {
        throw new CustomError(
            elegibilidade.motivoBloqueio ??
                'Esta reserva não pode ser remarcada.',
            400,
            ''
        );
    }

    const periodo = normalizarPeriodoHospedagem(
        body.dataCheckIn,
        body.dataCheckOut
    );
    if (!periodo.checkin || !periodo.checkout) {
        throw new CustomError(
            'Informe as novas datas de check-in e check-out.',
            400,
            ''
        );
    }

    const checkinNovo = periodo.checkin;
    const checkoutNovo = periodo.checkout;
    const checkinAnterior = new Date(reserva.checkin);
    const checkoutAnterior = new Date(reserva.checkout);

    if (
        checkinAnterior.getTime() === checkinNovo.getTime() &&
        checkoutAnterior.getTime() === checkoutNovo.getTime()
    ) {
        throw new CustomError('O período informado é o mesmo da reserva.', 400, '');
    }

    await validarDisponibilidadeRemarcacao(reserva, checkinNovo, checkoutNovo);

    const taxa = elegibilidade.taxaRemarcacao ?? 0;

    if (taxa === 0) {
        await connection.transaction(async (t: Transaction) => {
            await adquirirLockRemarcacaoCliente(id, t);
            const reservaLocked = await carregarReservaRemarcacao(id);
            assertUsuarioDonoReservaPublica(reservaLocked, idUsuario);

            const revalidacao = avaliarElegibilidadeRemarcacaoCliente({
                reserva: reservaLocked,
            });
            if (!revalidacao.podeRemarcar || (revalidacao.taxaRemarcacao ?? 0) !== 0) {
                throw new CustomError(
                    'A remarcação gratuita não está mais disponível para esta reserva.',
                    400,
                    ''
                );
            }

            await validarDisponibilidadeRemarcacao(
                reservaLocked,
                checkinNovo,
                checkoutNovo
            );

            await alterarPeriodoReservaCliente({
                reserva: reservaLocked,
                idUsuario,
                checkin: checkinNovo,
                checkout: checkoutNovo,
                transaction: t,
            });
        });

        await notificarAlteracaoPeriodo(id);

        const reservaAtualizada = await ReservaHospedagem.findByPk(id);
        if (!reservaAtualizada) {
            throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
        }

        return montarResultadoRemarcacao(reservaAtualizada, {
            remarcada: true,
            taxa: 0,
            checkinAnterior,
            checkoutAnterior,
            checkinNovo,
            checkoutNovo,
        });
    }

    const primeiraSuite = reserva.ReservaSuite?.[0];
    if (!primeiraSuite) {
        throw new CustomError('Reserva sem suíte vinculada.', 400, '');
    }

    let idTaxaCriada = 0;

    await connection.transaction(async (t: Transaction) => {
        await adquirirLockRemarcacaoCliente(id, t);

        const reservaLocked = await carregarReservaRemarcacao(id);
        assertUsuarioDonoReservaPublica(reservaLocked, idUsuario);

        const pendente = await buscarRemarcacaoPendentePorReserva(id);
        if (pendente) {
            idTaxaCriada = pendente.idTaxa;
            return;
        }

        const revalidacao = avaliarElegibilidadeRemarcacaoCliente({
            reserva: reservaLocked,
        });
        if (!revalidacao.podeRemarcar || (revalidacao.taxaRemarcacao ?? 0) <= 0) {
            throw new CustomError(
                'A taxa de remarcação não está mais disponível para esta reserva.',
                400,
                ''
            );
        }

        await validarDisponibilidadeRemarcacao(
            reservaLocked,
            checkinNovo,
            checkoutNovo
        );

        const ordem = await proximaOrdemTaxa(id, t);
        const taxaCriada = await ReservaHospedagemTaxaAdicional.create(
            {
                idReservaHospedagem: id,
                idReservaSuite: primeiraSuite.id,
                descricao: DESCRICAO_TAXA_REMARCACAO,
                valor: TAXA_REMARCACAO_CLIENTE,
                ordem,
                idUsuarioCriacao: idUsuario,
            },
            { transaction: t }
        );
        idTaxaCriada = Number(taxaCriada.id);

        await recalcularFinanceiroReservaComServicos(id, t, {
            idUsuarioHistorico: idUsuario,
            descricaoHistorico: `Taxa de remarcação incluída (${TAXA_REMARCACAO_CLIENTE.toFixed(2)})`,
        });

        if (reservaLocked.idTransacao) {
            await HistoricoTransacao.create(
                {
                    idTransacao: reservaLocked.idTransacao,
                    idUsuario,
                    data: new Date(),
                    descricao: montarHistoricoRemarcacaoPendente({
                        idReserva: id,
                        idTaxa: idTaxaCriada,
                        checkin: checkinNovo,
                        checkout: checkoutNovo,
                    }),
                },
                { transaction: t }
            );
        }
    });

    const reservaAtualizada = await ReservaHospedagem.findByPk(id);
    if (!reservaAtualizada) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    return montarResultadoRemarcacao(reservaAtualizada, {
        remarcada: false,
        aguardandoPagamento: true,
        taxa: TAXA_REMARCACAO_CLIENTE,
        valorPagamento: TAXA_REMARCACAO_CLIENTE,
        checkinAnterior,
        checkoutAnterior,
        checkinNovo,
        checkoutNovo,
        idTaxa: idTaxaCriada,
    });
}

export async function aplicarRemarcacaoPagaCliente(params: {
    idReserva: number;
    idUsuario: number;
    idTaxa: number;
    valorPago: number;
    comprovante: string;
    formaPagamento: string;
    transaction?: Transaction;
}): Promise<void> {
    const pendente = await buscarRemarcacaoPendentePorReserva(params.idReserva);
    if (!pendente || pendente.idTaxa !== params.idTaxa) {
        throw new CustomError(
            'Remarcação pendente não encontrada para esta reserva.',
            404,
            ''
        );
    }

    const reserva = await carregarReservaRemarcacao(params.idReserva);
    assertUsuarioDonoReservaPublica(reserva, params.idUsuario);

    if (reserva.idTransacao) {
        const jaConcluida = await HistoricoTransacao.findOne({
            where: {
                idTransacao: reserva.idTransacao,
                descricao: montarHistoricoRemarcacaoConcluida(params.idTaxa),
            },
            transaction: params.transaction,
        });
        if (jaConcluida) {
            return;
        }
    }

    const executar = async (t: Transaction) => {
        await adquirirLockRemarcacaoCliente(params.idReserva, t);

        const reservaLocked = await carregarReservaRemarcacao(params.idReserva);
        await validarDisponibilidadeRemarcacao(
            reservaLocked,
            pendente.checkin,
            pendente.checkout
        );

        await alterarPeriodoReservaCliente({
            reserva: reservaLocked,
            idUsuario: params.idUsuario,
            checkin: pendente.checkin,
            checkout: pendente.checkout,
            motivo: 'Remarcação pelo cliente após pagamento da taxa',
            transaction: t,
        });

        if (reservaLocked.idTransacao) {
            await HistoricoTransacao.create(
                {
                    idTransacao: reservaLocked.idTransacao,
                    idUsuario: params.idUsuario,
                    data: new Date(),
                    descricao: montarHistoricoRemarcacaoConcluida(params.idTaxa),
                },
                { transaction: t }
            );
        }
    };

    if (params.transaction) {
        await executar(params.transaction);
    } else {
        await connection.transaction(executar);
        await notificarAlteracaoPeriodo(params.idReserva);
    }
}

async function montarPixPendenteRemarcacao(
    reserva: ReservaHospedagem,
    pendente: RemarcacaoPendenteHistorico | null
): Promise<PixRemarcacaoPendenteDto | null> {
    if (!pendente || !reserva.idTransacao) {
        return null;
    }

    const { buscarPaymentIdPixRemarcacaoPorTaxa } = await import(
        './hospedagemRemarcacaoPagamentoService'
    );
    const paymentId = await buscarPaymentIdPixRemarcacaoPorTaxa(
        reserva.idTransacao,
        pendente.idTaxa
    );
    if (!paymentId) {
        return null;
    }

    return {
        paymentId,
        reutilizado: true,
    };
}

export async function obterStatusRemarcacaoMinhaReserva(
    idReserva: number,
    idUsuarioJwt: number
) {
    const reserva = await carregarReservaRemarcacao(idReserva);
    assertUsuarioDonoReservaPublica(reserva, idUsuarioJwt);

    const pendente = await buscarRemarcacaoPendentePorReserva(idReserva);
    const pixPendente = await montarPixPendenteRemarcacao(reserva, pendente);
    const dto = montarRemarcacaoClienteDto(reserva, pendente, undefined, pixPendente);

    return {
        ...dto,
        reservaId: idReserva,
        remarcacaoConcluida: !pendente,
    };
}

export { isHistoricoRemarcacaoConcluida };
