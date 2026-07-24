import { Op, Sequelize, Transaction, WhereOptions } from 'sequelize';
import { fromZonedTime, toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { startOfDay, endOfDay } from 'date-fns';
import connection from '../database';
import { Evento } from '../models/Evento';
import { EventoSuite } from '../models/EventoSuite';
import {
    ReservaHospedagem,
    StatusReservaHospedagem,
} from '../models/ReservaHospedagem';
import { ReservaSuite, StatusReservaSuite } from '../models/ReservaSuite';
import { ReservaHospede } from '../models/ReservaHospede';
import { PagamentoHospedagem } from '../models/PagamentoHospedagem';
import { ProdutorAcesso } from '../models/Produtor';
import { Usuario } from '../models/Usuario';
import {
    Transacao,
    HistoricoTransacao,
} from '../models/Transacao';
import { CustomError } from '../utils/customError';
import { toNumber } from '../utils/reservaSuiteUtils';
import {
    calcularSaldoPendente,
    labelFormaPagamentoRecepcao,
} from '../utils/hospedagemPagamentoRecepcao';

function resolverOrigemReserva(
    reserva: ReservaHospedagem & {
        origemReserva?: 'SITE' | 'ATENDENTE' | 'CLIENTE' | null;
        idUsuarioCriacao?: number | null;
        formaPagamentoRecepcao?: string | null;
        comprovantePagamento?: string | null;
        observacaoPagamento?: string | null;
        valorPago?: number;
    },
    temPagamentoHospedagem = false
): 'SITE' | 'ATENDENTE' {
    if (reserva.origemReserva === 'ATENDENTE') {
        return 'ATENDENTE';
    }
    if (
        temPagamentoHospedagem ||
        Number(reserva.idUsuarioCriacao ?? 0) > 0 ||
        reserva.formaPagamentoRecepcao ||
        reserva.comprovantePagamento ||
        reserva.observacaoPagamento ||
        toNumber(reserva.valorPago) > 0
    ) {
        return 'ATENDENTE';
    }
    if (reserva.origemReserva === 'SITE' || reserva.origemReserva === 'CLIENTE') {
        return 'SITE';
    }
    return 'SITE';
}

/** Consolida valor pago / saldo (colunas denormalizadas ou soma de PagamentoHospedagem). */
function resolverFinanceiroReserva(
    rh: ReservaHospedagem & {
        valorPago?: number;
        saldoPendente?: number | null;
        Pagamentos?: Array<{ valor?: number }>;
    }
): { valorPago: number; saldoPendente: number } {
    const valorTotal = toNumber(rh.valorTotal);
    const somaPagamentos = (rh.Pagamentos ?? []).reduce(
        (acc, p) => acc + toNumber(p.valor),
        0
    );
    const valorPagoColuna = toNumber(rh.valorPago ?? 0);
    const valorPago =
        valorPagoColuna > 0 ? valorPagoColuna : toNumber(somaPagamentos);

    const saldoColuna =
        rh.saldoPendente != null && rh.saldoPendente !== undefined
            ? toNumber(rh.saldoPendente)
            : null;
    const saldoPendente =
        saldoColuna != null && !(valorPagoColuna <= 0 && somaPagamentos > 0)
            ? saldoColuna
            : calcularSaldoPendente(valorTotal, valorPago);

    return { valorPago, saldoPendente };
}

const TZ = 'America/Cuiaba';
const PAGE_SIZE_DEFAULT = 20;

export type FiltroReservasAdmin =
    | 'hoje'
    | 'checkin'
    | 'hospedados'
    | 'checkout'
    | 'checkout_realizado'
    | 'aguardando_pagamento'
    | 'pendentes'
    | 'confirmadas'
    | 'canceladas'
    | 'expiradas'
    | 'online'
    | 'atendente'
    | 'todos'
    | '';

export type OrdenacaoReservasAdmin =
    | 'recentes'
    | 'antigas'
    | 'checkin'
    | 'checkout'
    | 'nome';

type UsuarioResumo = {
    nomeCompleto?: string | null;
    telefone?: string | null;
    email?: string | null;
};

type SuiteComEvento = ReservaSuite & {
    EventoSuite?: Pick<EventoSuite, 'nome'> | null;
};

type ReservaComIncludes = ReservaHospedagem & {
    Usuario?: UsuarioResumo | null;
    UsuarioCriacao?: UsuarioResumo | null;
    Evento?: { id: number; nome: string; idProdutor?: number } | null;
    ReservaSuite?: SuiteComEvento[];
    Transacao?: Transacao | null;
    createdAt?: Date;
};

function boundsHojeCuiaba(agora = new Date()): { inicio: Date; fim: Date; agoraLocal: Date } {
    const agoraLocal = toZonedTime(agora, TZ);
    const inicioLocal = startOfDay(agoraLocal);
    const fimLocal = endOfDay(agoraLocal);
    return {
        inicio: fromZonedTime(inicioLocal, TZ),
        fim: fromZonedTime(fimLocal, TZ),
        agoraLocal,
    };
}

/** Status para exibição: Confirmada/Hospedada com checkout já passado → CheckOutRealizado. */
export function statusExibicaoReserva(
    status: string,
    checkout: Date | string
): string {
    if (status === StatusReservaHospedagem.CheckOutRealizado) {
        return 'CheckOutRealizado';
    }
    if (
        status === StatusReservaHospedagem.Confirmada ||
        status === StatusReservaHospedagem.Hospedada
    ) {
        const fim = checkout instanceof Date ? checkout : new Date(checkout);
        if (!Number.isNaN(fim.getTime()) && fim.getTime() < Date.now()) {
            return 'CheckOutRealizado';
        }
    }
    return status;
}

function statusOcupaOperacional(status: string): boolean {
    return (
        status === StatusReservaHospedagem.Confirmada ||
        status === StatusReservaHospedagem.Hospedada
    );
}

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

function montarWhereFiltro(
    filtro: FiltroReservasAdmin
): WhereOptions | undefined {
    const { inicio, fim } = boundsHojeCuiaba();
    const agora = new Date();

    switch (filtro) {
        case 'hoje':
            return {
                [Op.or]: [
                    { checkin: { [Op.between]: [inicio, fim] } },
                    { checkout: { [Op.between]: [inicio, fim] } },
                    {
                        [Op.and]: [
                            {
                                status: {
                                    [Op.in]: [
                                        StatusReservaHospedagem.Confirmada,
                                        StatusReservaHospedagem.Hospedada,
                                    ],
                                },
                            },
                            { checkin: { [Op.lte]: agora } },
                            { checkout: { [Op.gt]: agora } },
                        ],
                    },
                ],
            };
        case 'checkin':
            return { checkin: { [Op.between]: [inicio, fim] } };
        case 'checkout':
            return { checkout: { [Op.between]: [inicio, fim] } };
        case 'hospedados':
            return {
                status: {
                    [Op.in]: [
                        StatusReservaHospedagem.Confirmada,
                        StatusReservaHospedagem.Hospedada,
                    ],
                },
                checkin: { [Op.lte]: agora },
                checkout: { [Op.gt]: agora },
            };
        case 'aguardando_pagamento':
        case 'pendentes':
            return { status: StatusReservaHospedagem.AguardandoPagamento };
        case 'confirmadas':
            return {
                status: {
                    [Op.in]: [
                        StatusReservaHospedagem.Confirmada,
                        StatusReservaHospedagem.Hospedada,
                    ],
                },
            };
        case 'canceladas':
            return { status: StatusReservaHospedagem.Cancelada };
        case 'expiradas':
            return { status: StatusReservaHospedagem.Expirada };
        case 'checkout_realizado':
            return {
                [Op.or]: [
                    { status: StatusReservaHospedagem.CheckOutRealizado },
                    {
                        status: {
                            [Op.in]: [
                                StatusReservaHospedagem.Confirmada,
                                StatusReservaHospedagem.Hospedada,
                            ],
                        },
                        checkout: { [Op.lt]: agora },
                    },
                ],
            };
        case 'online':
            return {
                [Op.or]: [
                    { origemReserva: 'SITE' },
                    { origemReserva: 'CLIENTE' as any },
                    { origemReserva: { [Op.is]: null } as any },
                ],
            };
        case 'atendente':
            return { origemReserva: 'ATENDENTE' };
        case 'todos':
        case '':
        default:
            return undefined;
    }
}

function montarOrder(
    ordenacao: OrdenacaoReservasAdmin
): Array<[string | ReturnType<typeof Sequelize.col>, string]> {
    switch (ordenacao) {
        case 'antigas':
            return [['id', 'ASC']];
        case 'checkin':
            return [['checkin', 'ASC'], ['id', 'DESC']];
        case 'checkout':
            return [['checkout', 'ASC'], ['id', 'DESC']];
        case 'nome':
            return [
                [Sequelize.col('Usuario.nomeCompleto'), 'ASC'],
                ['id', 'DESC'],
            ];
        case 'recentes':
        default:
            return [['id', 'DESC']];
    }
}

function mapearResumoLista(reserva: ReservaComIncludes) {
    const suites = reserva.ReservaSuite ?? [];
    const suitesResumo = suites.map((suite) => ({
        nome: suite.EventoSuite?.nome ?? `Suíte ${suite.idEventoSuite}`,
        quantidade: 1,
        adultos: suite.adultos,
        criancas: suite.criancas,
        preco: toNumber(suite.preco),
    }));

    const totalAdultos = suites.reduce((acc, s) => acc + Number(s.adultos || 0), 0);
    const totalCriancas = suites.reduce(
        (acc, s) => acc + Number(s.criancas || 0),
        0
    );

    const status = statusExibicaoReserva(reserva.status, reserva.checkout);
    const financeiro = resolverFinanceiroReserva(
        reserva as ReservaHospedagem & {
            valorPago?: number;
            saldoPendente?: number | null;
            Pagamentos?: Array<{ valor?: number }>;
        }
    );
    const origemReserva = resolverOrigemReserva(
        reserva as ReservaHospedagem & {
            origemReserva?: 'SITE' | 'ATENDENTE' | 'CLIENTE' | null;
            idUsuarioCriacao?: number | null;
            formaPagamentoRecepcao?: string | null;
            comprovantePagamento?: string | null;
            observacaoPagamento?: string | null;
            valorPago?: number;
        },
        financeiro.valorPago > 0
    );

    return {
        idReservaHospedagem: reserva.id,
        numeroReserva: reserva.id,
        status,
        statusOriginal: reserva.status,
        checkin: reserva.checkin,
        checkout: reserva.checkout,
        noites: reserva.noites,
        valorTotal: toNumber(reserva.valorTotal),
        valorPago: financeiro.valorPago,
        saldoPendente: financeiro.saldoPendente,
        formaPagamentoRecepcao:
            (reserva as ReservaHospedagem & {
                formaPagamentoRecepcao?: string | null;
            }).formaPagamentoRecepcao ?? null,
        origemReserva,
        idUsuarioCriacao:
            (reserva as ReservaHospedagem & {
                idUsuarioCriacao?: number | null;
            }).idUsuarioCriacao ?? null,
        nomeUsuarioCriacao:
            (reserva as ReservaComIncludes).UsuarioCriacao?.nomeCompleto ?? null,
        dataCriacao:
            (reserva as ReservaComIncludes).createdAt ??
            reserva.dataConfirmacao ??
            null,
        taxaServico: toNumber(reserva.taxaServico),
        preco: toNumber(reserva.preco),
        nomeResponsavel: reserva.Usuario?.nomeCompleto ?? '—',
        telefone: reserva.Usuario?.telefone ?? null,
        email: reserva.Usuario?.email ?? null,
        quantidadeSuites: suites.length,
        totalAdultos,
        totalCriancas,
        suites: suitesResumo,
        // Campos de conveniência para o card (layout atual)
        nomeSuite: suitesResumo[0]?.nome ?? 'Suíte',
        adultos: totalAdultos,
        criancas: totalCriancas,
        responsavel: reserva.Usuario?.nomeCompleto ?? '—',
        id: reserva.id,
        dataHoraCheckinReal:
            (reserva as ReservaHospedagem & {
                dataHoraCheckinReal?: Date | null;
            }).dataHoraCheckinReal ?? null,
        dataHoraCheckoutRealizado:
            (reserva as ReservaHospedagem & {
                dataHoraCheckoutRealizado?: Date | null;
            }).dataHoraCheckoutRealizado ?? null,
        idUsuarioCheckout:
            (reserva as ReservaHospedagem & {
                idUsuarioCheckout?: number | null;
            }).idUsuarioCheckout ?? null,
    };
}

export async function listarReservasAdmin(params: {
    idUsuario: number;
    busca?: string;
    filtro?: string;
    ordenacao?: string;
    page?: number;
    pageSize?: number;
}) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(
        100,
        Math.max(1, Number(params.pageSize) || PAGE_SIZE_DEFAULT)
    );
    const filtro = (params.filtro || 'todos') as FiltroReservasAdmin;
    const ordenacao = (params.ordenacao || 'recentes') as OrdenacaoReservasAdmin;
    const busca = (params.busca || '').trim();

    const escopo = await resolverEscopoProdutor(params.idUsuario);

    const whereFiltro = montarWhereFiltro(filtro);
    const whereReserva: WhereOptions = {
        ...(whereFiltro || {}),
    };

    if (busca) {
        const like = `%${busca}%`;
        const orBusca: any[] = [
            Sequelize.where(
                Sequelize.cast(Sequelize.col('ReservaHospedagem.id'), 'CHAR'),
                { [Op.like]: like }
            ),
            { '$Usuario.nomeCompleto$': { [Op.like]: like } },
            { '$Usuario.telefone$': { [Op.like]: like } },
            { '$Usuario.email$': { [Op.like]: like } },
            Sequelize.literal(
                `EXISTS (
                    SELECT 1
                    FROM ReservaHospede AS rh
                    INNER JOIN ReservaSuite AS rs ON rs.id = rh.idReservaSuite
                    WHERE rs.idReservaHospedagem = ReservaHospedagem.id
                      AND rh.nome LIKE ${connection.escape(like)}
                )`
            ),
        ];
        (whereReserva as any)[Op.and] = [
            ...((whereReserva as any)[Op.and] || []),
            { [Op.or]: orBusca },
        ];
    }

    const eventoWhere: WhereOptions = {
        tipo: 'Pousada',
        ...(escopo.admGeral ? {} : { idProdutor: { [Op.in]: escopo.idsProdutor } }),
    };

    const { rows, count } = await ReservaHospedagem.findAndCountAll({
        where: whereReserva,
        include: [
            {
                model: Usuario,
                as: 'Usuario',
                attributes: ['id', 'nomeCompleto', 'telefone', 'email'],
                required: false,
            },
            {
                model: Usuario,
                as: 'UsuarioCriacao',
                attributes: ['id', 'nomeCompleto'],
                required: false,
            },
            {
                model: PagamentoHospedagem,
                as: 'Pagamentos',
                attributes: ['id', 'valor', 'formaPagamento', 'dataPagamento'],
                required: false,
            },
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'nome', 'idProdutor'],
                where: eventoWhere,
                required: true,
            },
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                attributes: [
                    'id',
                    'idEventoSuite',
                    'adultos',
                    'criancas',
                    'preco',
                    'taxaServico',
                    'valorTotal',
                    'status',
                ],
                required: false,
                include: [
                    {
                        model: EventoSuite,
                        as: 'EventoSuite',
                        attributes: ['id', 'nome'],
                        required: false,
                    },
                ],
            },
        ],
        order: montarOrder(ordenacao) as any,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        distinct: true,
        subQuery: false,
    });

    const data = (rows as ReservaComIncludes[]).map(mapearResumoLista);
    const totalPages = Math.max(1, Math.ceil(count / pageSize));

    return {
        data,
        meta: {
            page,
            pageSize,
            total: count,
            totalPages,
            hasMore: page < totalPages,
            filtro,
            ordenacao,
            busca: busca || null,
        },
    };
}

export async function obterReservaAdminDetalhe(
    idReserva: number,
    idUsuario: number
) {
    const escopo = await resolverEscopoProdutor(idUsuario);

    const eventoWhere: WhereOptions = {
        tipo: 'Pousada',
        ...(escopo.admGeral ? {} : { idProdutor: { [Op.in]: escopo.idsProdutor } }),
    };

    const reserva = (await ReservaHospedagem.findOne({
        where: { id: idReserva },
        include: [
            {
                model: Usuario,
                as: 'Usuario',
                attributes: [
                    'id',
                    'nomeCompleto',
                    'telefone',
                    'email',
                    'cpf',
                ],
                required: false,
            },
            {
                model: Usuario,
                as: 'UsuarioCriacao',
                attributes: ['id', 'nomeCompleto'],
                required: false,
            },
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'nome', 'imagem', 'endereco', 'idProdutor'],
                where: eventoWhere,
                required: true,
            },
            {
                model: Transacao,
                as: 'Transacao',
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
                        attributes: ['id', 'nome', 'descricao'],
                        required: false,
                    },
                    {
                        model: ReservaHospede,
                        as: 'ReservaHospede',
                        attributes: ['id', 'nome', 'tipo', 'dataNascimento'],
                        required: false,
                    },
                ],
            },
        ],
    })) as ReservaComIncludes | null;

    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    const suites = (reserva.ReservaSuite ?? []).map((suite) => {
        const hospedes = (
            (suite as SuiteComEvento & {
                ReservaHospede?: Array<{
                    id: number;
                    nome: string;
                    tipo: string;
                    dataNascimento?: Date | string | null;
                }>;
            }).ReservaHospede ?? []
        ).map((h) => ({
            id: h.id,
            nome: h.nome,
            tipo: h.tipo,
            dataNascimento: h.dataNascimento
                ? String(h.dataNascimento)
                : null,
        }));

        return {
            idReservaSuite: suite.id,
            idEventoSuite: suite.idEventoSuite,
            nome: suite.EventoSuite?.nome ?? `Suíte ${suite.idEventoSuite}`,
            adultos: suite.adultos,
            criancas: suite.criancas,
            preco: toNumber(suite.preco),
            taxaServico: toNumber(suite.taxaServico),
            valorTotal: toNumber(suite.valorTotal),
            valorOriginal:
                suite.valorOriginal != null
                    ? toNumber(suite.valorOriginal)
                    : null,
            descontoTipo: suite.descontoTipo ?? null,
            descontoValor:
                suite.descontoValor != null
                    ? toNumber(suite.descontoValor)
                    : null,
            valorFinal:
                suite.valorFinal != null ? toNumber(suite.valorFinal) : null,
            status: suite.status,
            hospedes,
        };
    });

    let timeline: Array<{
        id: number;
        data: Date;
        descricao: string;
        usuario?: string | null;
    }> = [];

    if (reserva.idTransacao) {
        const historicos = await HistoricoTransacao.findAll({
            where: { idTransacao: reserva.idTransacao },
            order: [['data', 'ASC']],
            include: [
                {
                    model: Usuario,
                    as: 'Usuario',
                    attributes: ['nomeCompleto'],
                    required: false,
                },
            ],
        });

        timeline = historicos.map((h) => {
            const row = h as HistoricoTransacao & {
                Usuario?: { nomeCompleto?: string | null };
            };
            return {
                id: row.id,
                data: row.data,
                descricao: row.descricao,
                usuario: row.Usuario?.nomeCompleto ?? null,
            };
        });
    }

    const transacao = reserva.Transacao
        ? {
              id: reserva.Transacao.id,
              status: reserva.Transacao.status,
              preco: toNumber(reserva.Transacao.preco),
              taxaServico: toNumber(reserva.Transacao.taxaServico),
              valorTotal: toNumber(reserva.Transacao.valorTotal),
              valorRecebido: toNumber(reserva.Transacao.valorRecebido ?? 0),
              tipoPagamento: reserva.Transacao.tipoPagamento ?? null,
              gatewayPagamento: reserva.Transacao.gatewayPagamento ?? null,
              dataPagamento: reserva.Transacao.dataPagamento ?? null,
              dataTransacao: reserva.Transacao.dataTransacao,
          }
        : null;

    const status = statusExibicaoReserva(reserva.status, reserva.checkout);

    const pagamentosRows = await PagamentoHospedagem.findAll({
        where: { idReservaHospedagem: reserva.id },
        order: [['dataPagamento', 'ASC']],
        include: [
            {
                model: Usuario,
                as: 'Usuario',
                attributes: ['nomeCompleto'],
                required: false,
            },
        ],
    });

    const pagamentos = pagamentosRows.map((p) => {
        const row = p as PagamentoHospedagem & {
            Usuario?: { nomeCompleto?: string | null };
        };
        return {
            id: row.id,
            valor: toNumber(row.valor),
            dataPagamento: row.dataPagamento,
            formaPagamento: row.formaPagamento,
            formaPagamentoLabel: labelFormaPagamentoRecepcao(row.formaPagamento),
            comprovante: row.comprovante ?? null,
            observacao: row.observacao ?? null,
            idUsuario: row.idUsuario,
            usuario: row.Usuario?.nomeCompleto ?? null,
        };
    });

    const financeiro = resolverFinanceiroReserva({
        ...(reserva as ReservaHospedagem),
        Pagamentos: pagamentos.map((p) => ({ valor: p.valor })),
    } as ReservaHospedagem & {
        valorPago?: number;
        saldoPendente?: number | null;
        Pagamentos?: Array<{ valor?: number }>;
    });
    const valorPago = financeiro.valorPago;
    const saldoPendente = financeiro.saldoPendente;
    const origemReserva = resolverOrigemReserva(
        reserva as ReservaHospedagem & {
            origemReserva?: 'SITE' | 'ATENDENTE' | 'CLIENTE' | null;
            idUsuarioCriacao?: number | null;
            formaPagamentoRecepcao?: string | null;
            comprovantePagamento?: string | null;
            observacaoPagamento?: string | null;
            valorPago?: number;
        },
        pagamentos.length > 0 || valorPago > 0
    );

    return {
        id: reserva.id,
        idReservaHospedagem: reserva.id,
        numeroReserva: reserva.id,
        status,
        statusOriginal: reserva.status,
        checkin: reserva.checkin,
        checkout: reserva.checkout,
        noites: reserva.noites,
        preco: toNumber(reserva.preco),
        taxaServico: toNumber(reserva.taxaServico),
        valorTotal: toNumber(reserva.valorTotal),
        valorPago,
        saldoPendente,
        formaPagamentoRecepcao:
            (reserva as ReservaHospedagem & {
                formaPagamentoRecepcao?: string | null;
            }).formaPagamentoRecepcao ?? null,
        observacaoPagamento:
            (reserva as ReservaHospedagem & {
                observacaoPagamento?: string | null;
            }).observacaoPagamento ?? null,
        comprovantePagamento:
            (reserva as ReservaHospedagem & {
                comprovantePagamento?: string | null;
            }).comprovantePagamento ?? null,
        origemReserva,
        idUsuarioCriacao:
            (reserva as ReservaHospedagem & {
                idUsuarioCriacao?: number | null;
            }).idUsuarioCriacao ?? null,
        nomeUsuarioCriacao:
            (reserva as ReservaComIncludes).UsuarioCriacao?.nomeCompleto ?? null,
        dataCriacao:
            (reserva as ReservaComIncludes).createdAt ??
            reserva.dataConfirmacao ??
            null,
        dataConfirmacao: reserva.dataConfirmacao ?? null,
        dataHoraCheckinReal:
            (reserva as ReservaHospedagem & {
                dataHoraCheckinReal?: Date | null;
            }).dataHoraCheckinReal ?? null,
        idUsuarioCheckin:
            (reserva as ReservaHospedagem & {
                idUsuarioCheckin?: number | null;
            }).idUsuarioCheckin ?? null,
        dataHoraCheckoutRealizado:
            (reserva as ReservaHospedagem & {
                dataHoraCheckoutRealizado?: Date | null;
            }).dataHoraCheckoutRealizado ?? null,
        idUsuarioCheckout:
            (reserva as ReservaHospedagem & {
                idUsuarioCheckout?: number | null;
            }).idUsuarioCheckout ?? null,
        usuarioCheckout:
            (reserva as ReservaHospedagem & {
                idUsuarioCheckout?: number | null;
            }).idUsuarioCheckout ?? null,
        observacoes:
            (reserva as ReservaHospedagem & {
                observacoes?: string | null;
            }).observacoes ?? null,
        idTransacao: reserva.idTransacao ?? null,
        responsavel: reserva.Usuario?.nomeCompleto ?? '—',
        nomeResponsavel: reserva.Usuario?.nomeCompleto ?? '—',
        telefone: reserva.Usuario?.telefone ?? null,
        email: reserva.Usuario?.email ?? null,
        evento: reserva.Evento
            ? {
                  id: reserva.Evento.id,
                  nome: reserva.Evento.nome,
              }
            : null,
        suites,
        pagamentos,
        pagamento: transacao,
        transacao,
        timeline,
    };
}

export type StatusOperacionalSuite =
    | 'Livre'
    | 'Hospedada'
    | 'Ocupada'
    | 'CheckInHoje'
    | 'CheckOutHoje'
    | 'AguardandoPagamento'
    | 'Manutencao'
    | 'Bloqueada';

export type FiltroSuitesOperacional =
    | 'todas'
    | 'livres'
    | 'ocupadas'
    | 'hospedadas'
    | 'checkin_hoje'
    | 'checkout_hoje'
    | 'aguardando_pagamento'
    | 'manutencao'
    | 'bloqueadas'
    | '';

type ReservaSuiteComHospedagem = ReservaSuite & {
    ReservaHospedagem?: ReservaHospedagem & {
        Usuario?: UsuarioResumo | null;
    };
};

type RefDiaCuiaba = {
    dataReferencia: string;
    inicio: Date;
    fim: Date;
    ehHoje: boolean;
};

type EventoAgendaSuite = {
    tipo: 'reserva' | 'checkin' | 'checkout';
    idReservaHospedagem: number;
    idEventoSuite: number;
    suiteNome: string;
    inicio: string;
    fim: string;
    status: string;
    responsavel: string | null;
    dataHoraCheckinReal?: string | null;
    dataHoraCheckoutRealizado?: string | null;
};

function formatDataCuiaba(d: Date): string {
    const local = toZonedTime(d, TZ);
    const y = local.getFullYear();
    const mo = String(local.getMonth() + 1).padStart(2, '0');
    const day = String(local.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function resolverDataReferencia(data?: string): RefDiaCuiaba {
    const hojeStr = formatDataCuiaba(new Date());
    const dataReferencia =
        data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : hojeStr;
    const [y, mo, d] = dataReferencia.split('-').map(Number);
    const refLocal = new Date(y, mo - 1, d);
    const inicioLocal = startOfDay(refLocal);
    const fimLocal = endOfDay(refLocal);
    return {
        dataReferencia,
        inicio: fromZonedTime(inicioLocal, TZ),
        fim: fromZonedTime(fimLocal, TZ),
        ehHoje: dataReferencia === hojeStr,
    };
}

function resolverMesReferencia(mes: string | undefined, dataReferencia: string): string {
    if (mes && /^\d{4}-\d{2}$/.test(mes)) {
        return mes;
    }
    return dataReferencia.slice(0, 7);
}

function boundsMesCuiaba(mesStr: string): {
    inicio: Date;
    fim: Date;
    diasNoMes: number;
} {
    const [y, mo] = mesStr.split('-').map(Number);
    const primeiroLocal = new Date(y, mo - 1, 1);
    const ultimoDia = new Date(y, mo, 0).getDate();
    const ultimoLocal = new Date(y, mo - 1, ultimoDia);
    return {
        inicio: fromZonedTime(startOfDay(primeiroLocal), TZ),
        fim: fromZonedTime(endOfDay(ultimoLocal), TZ),
        diasNoMes: ultimoDia,
    };
}

function isSameDayCuiaba(a: Date | string, b: Date | string): boolean {
    const da = toZonedTime(a instanceof Date ? a : new Date(a), TZ);
    const db = toZonedTime(b instanceof Date ? b : new Date(b), TZ);
    return (
        da.getFullYear() === db.getFullYear() &&
        da.getMonth() === db.getMonth() &&
        da.getDate() === db.getDate()
    );
}

function reservaSobrepoeDia(
    checkin: Date,
    checkout: Date,
    diaInicio: Date,
    diaFim: Date
): boolean {
    return checkin < diaFim && checkout > diaInicio;
}

function reservaRelevanteNoDia(
    rh: ReservaHospedagem,
    ref: RefDiaCuiaba
): boolean {
    const checkin = new Date(rh.checkin);
    const checkout = new Date(rh.checkout);
    if (checkout <= ref.inicio) return false;
    if (rh.status === StatusReservaHospedagem.AguardandoPagamento) {
        return reservaSobrepoeDia(checkin, checkout, ref.inicio, ref.fim);
    }
    if (statusOcupaOperacional(rh.status)) {
        return reservaSobrepoeDia(checkin, checkout, ref.inicio, ref.fim);
    }
    return false;
}

function suiteOcupadaNaReferencia(
    checkin: Date,
    checkout: Date,
    ref: RefDiaCuiaba
): boolean {
    if (ref.ehHoje) {
        const agora = new Date();
        return checkin <= agora && agora < checkout;
    }
    return reservaSobrepoeDia(checkin, checkout, ref.inicio, ref.fim);
}

function montarEventoAgenda(
    item: ReservaSuiteComHospedagem,
    suiteNome: string,
    tipo: EventoAgendaSuite['tipo']
): EventoAgendaSuite {
    const rh = item.ReservaHospedagem!;
    const dataHoraCheckinReal =
        (rh as ReservaHospedagem & { dataHoraCheckinReal?: Date | null })
            ?.dataHoraCheckinReal ?? null;
    const dataHoraCheckoutRealizado =
        (rh as ReservaHospedagem & { dataHoraCheckoutRealizado?: Date | null })
            ?.dataHoraCheckoutRealizado ?? null;
    return {
        tipo,
        idReservaHospedagem: rh.id,
        idEventoSuite: item.idEventoSuite,
        suiteNome,
        inicio: new Date(rh.checkin).toISOString(),
        // Barra termina no check-out real quando já foi feito
        fim: new Date(
            dataHoraCheckoutRealizado ?? rh.checkout
        ).toISOString(),
        status: rh.status,
        responsavel: rh.Usuario?.nomeCompleto ?? null,
        dataHoraCheckinReal: dataHoraCheckinReal
            ? new Date(dataHoraCheckinReal).toISOString()
            : null,
        dataHoraCheckoutRealizado: dataHoraCheckoutRealizado
            ? new Date(dataHoraCheckoutRealizado).toISOString()
            : null,
    };
}

function montarCalendarioMes(
    mesStr: string,
    reservasMes: ReservaSuiteComHospedagem[],
    nomesSuites: Map<number, string>,
    idsSuites: number[]
) {
    const { diasNoMes } = boundsMesCuiaba(mesStr);
    const [ano, mesNum] = mesStr.split('-').map(Number);
    const dias: Array<{
        data: string;
        indicadores: {
            checkin: number;
            checkout: number;
            ocupada: number;
            livre: number;
            bloqueada: number;
            manutencao: number;
        };
        eventosAgenda: EventoAgendaSuite[];
    }> = [];

    for (let dia = 1; dia <= diasNoMes; dia += 1) {
        const dataStr = `${mesStr}-${String(dia).padStart(2, '0')}`;
        const refLocal = new Date(ano, mesNum - 1, dia);
        const diaInicio = fromZonedTime(startOfDay(refLocal), TZ);
        const diaFim = fromZonedTime(endOfDay(refLocal), TZ);

        let checkin = 0;
        let checkout = 0;
        let ocupada = 0;
        const suitesComReserva = new Set<number>();
        const eventosAgenda: EventoAgendaSuite[] = [];

        for (const item of reservasMes) {
            const rh = item.ReservaHospedagem;
            if (!rh || !statusOcupaOperacional(rh.status)) {
                continue;
            }

            const ci = new Date(rh.checkin);
            const co = new Date(rh.checkout);
            if (!reservaSobrepoeDia(ci, co, diaInicio, diaFim)) {
                continue;
            }

            suitesComReserva.add(item.idEventoSuite);
            const suiteNome = nomesSuites.get(item.idEventoSuite) ?? '';
            const checkinNoDia = isSameDayCuiaba(ci, diaInicio);
            const checkoutNoDia = isSameDayCuiaba(co, diaInicio);
            const hospedada =
                rh.status === StatusReservaHospedagem.Hospedada;

            // Check-in (laranja): Confirmada sem check-in real neste dia
            if (
                checkinNoDia &&
                rh.status === StatusReservaHospedagem.Confirmada
            ) {
                checkin += 1;
                eventosAgenda.push(
                    montarEventoAgenda(item, suiteNome, 'checkin')
                );
            }
            // Check-out (laranja): Hospedada saindo no dia
            if (checkoutNoDia && hospedada) {
                checkout += 1;
                eventosAgenda.push(
                    montarEventoAgenda(item, suiteNome, 'checkout')
                );
            }
            // Hospedada (azul): já check-in, permanência
            if (hospedada && !checkoutNoDia) {
                ocupada += 1;
                if (!checkinNoDia) {
                    eventosAgenda.push(
                        montarEventoAgenda(item, suiteNome, 'reserva')
                    );
                }
            }
        }

        const livre = idsSuites.filter(
            (id) => !suitesComReserva.has(id)
        ).length;

        dias.push({
            data: dataStr,
            indicadores: {
                checkin,
                checkout,
                ocupada,
                livre,
                bloqueada: 0,
                manutencao: 0,
            },
            eventosAgenda,
        });
    }

    return {
        versao: 1 as const,
        modo: 'mes' as const,
        modoAgendaFuturo: 'timeline' as const,
        mes: mesStr,
        dias,
    };
}

function metaAgendaSuites() {
    return {
        versao: 1 as const,
        suporte: ['dia', 'mes', 'timeline'] as const,
        timezone: TZ,
    };
}

function montarMetaSuitesOperacionais(params: {
    filtro: FiltroSuitesOperacional;
    total: number;
    ref: RefDiaCuiaba;
    mesStr: string;
    reservasMes: ReservaSuiteComHospedagem[];
    nomesSuites: Map<number, string>;
    idsSuites: number[];
    mensagem?: string;
}) {
    return {
        filtro: params.filtro,
        total: params.total,
        dataReferencia: params.ref.dataReferencia,
        mes: params.mesStr,
        ...(params.mensagem ? { mensagem: params.mensagem } : {}),
        calendario: montarCalendarioMes(
            params.mesStr,
            params.reservasMes,
            params.nomesSuites,
            params.idsSuites
        ),
        agenda: metaAgendaSuites(),
    };
}

function escolherReservaRelevante(
    itens: ReservaSuiteComHospedagem[],
    ref: RefDiaCuiaba
): ReservaSuiteComHospedagem | null {
    if (!itens.length) return null;

    const agora = new Date();
    const scored = itens
        .map((item) => {
            const rh = item.ReservaHospedagem;
            if (!rh || !reservaRelevanteNoDia(rh, ref)) {
                return { item, score: -1 };
            }

            const checkin = new Date(rh.checkin);
            const checkout = new Date(rh.checkout);
            let score = 0;

            if (rh.status === StatusReservaHospedagem.AguardandoPagamento) {
                score = 40;
            } else if (rh.status === StatusReservaHospedagem.Hospedada) {
                if (isSameDayCuiaba(checkout, ref.inicio)) score = 95;
                else if (suiteOcupadaNaReferencia(checkin, checkout, ref)) {
                    score = 85;
                }
            } else if (rh.status === StatusReservaHospedagem.Confirmada) {
                if (isSameDayCuiaba(checkin, ref.inicio)) score = 90;
                else if (suiteOcupadaNaReferencia(checkin, checkout, ref)) {
                    score = 60;
                } else if (checkin > (ref.ehHoje ? agora : ref.fim)) {
                    score = 20;
                }
            }
            return { item, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);

    return scored[0]?.item ?? null;
}

function classificarStatusOperacional(
    item: ReservaSuiteComHospedagem | null,
    ref: RefDiaCuiaba
): StatusOperacionalSuite {
    if (!item?.ReservaHospedagem) {
        return 'Livre';
    }

    const rh = item.ReservaHospedagem;
    const checkin = new Date(rh.checkin);
    const checkout = new Date(rh.checkout);

    if (rh.status === StatusReservaHospedagem.AguardandoPagamento) {
        return 'AguardandoPagamento';
    }

    // Já fez check-in → nunca mais "Check-in Hoje"
    if (rh.status === StatusReservaHospedagem.Hospedada) {
        if (isSameDayCuiaba(checkout, ref.inicio)) {
            return 'CheckOutHoje';
        }
        if (suiteOcupadaNaReferencia(checkin, checkout, ref)) {
            return 'Hospedada';
        }
        return 'Livre';
    }

    // Confirmada (ainda sem check-in)
    if (rh.status === StatusReservaHospedagem.Confirmada) {
        if (isSameDayCuiaba(checkin, ref.inicio)) {
            return 'CheckInHoje';
        }
        if (suiteOcupadaNaReferencia(checkin, checkout, ref)) {
            // Reserva ativa sem check-in em outro dia: não rotular Check-in Hoje
            return 'Ocupada';
        }
    }

    return 'Livre';
}

/** Flags operacionais não exclusivas — uma suíte pode entrar em várias abas. */
function flagsOperacionaisSuite(
    item: ReservaSuiteComHospedagem | null,
    ref: RefDiaCuiaba
) {
    const rh = item?.ReservaHospedagem;

    if (!rh) {
        return {
            ocupadaAgora: false,
            hospedada: false,
            checkinHoje: false,
            checkoutHoje: false,
            aguardandoPagamento: false,
        };
    }

    if (rh.status === StatusReservaHospedagem.AguardandoPagamento) {
        return {
            ocupadaAgora: false,
            hospedada: false,
            checkinHoje: false,
            checkoutHoje: false,
            aguardandoPagamento: true,
        };
    }

    const checkin = new Date(rh.checkin);
    const checkout = new Date(rh.checkout);
    const noPeriodo = suiteOcupadaNaReferencia(checkin, checkout, ref);

    if (rh.status === StatusReservaHospedagem.Hospedada) {
        const checkoutHoje = isSameDayCuiaba(checkout, ref.inicio);
        return {
            ocupadaAgora: noPeriodo,
            hospedada: noPeriodo,
            checkinHoje: false,
            checkoutHoje,
            aguardandoPagamento: false,
        };
    }

    if (rh.status === StatusReservaHospedagem.Confirmada) {
        return {
            ocupadaAgora: false,
            hospedada: false,
            checkinHoje: isSameDayCuiaba(checkin, ref.inicio),
            checkoutHoje: false,
            aguardandoPagamento: false,
        };
    }

    return {
        ocupadaAgora: false,
        hospedada: false,
        checkinHoje: false,
        checkoutHoje: false,
        aguardandoPagamento: false,
    };
}

function mapearCardSuiteOperacional(
    suite: EventoSuite & { Evento?: { id: number; nome: string } | null },
    reservaSuite: ReservaSuiteComHospedagem | null,
    ref: RefDiaCuiaba
) {
    const statusOperacional = classificarStatusOperacional(reservaSuite, ref);
    const flags = flagsOperacionaisSuite(reservaSuite, ref);
    const rh = reservaSuite?.ReservaHospedagem;
    const disponivelAposCheckout = flags.checkoutHoje;
    const horarioCheckinPadrao = '16:00';
    const horarioCheckoutPadrao = '13:00';
    const dataHoraCheckinReal =
        (rh as ReservaHospedagem & { dataHoraCheckinReal?: Date | null })
            ?.dataHoraCheckinReal ?? null;

    const financeiro = rh
        ? resolverFinanceiroReserva(
              rh as ReservaHospedagem & {
                  valorPago?: number;
                  saldoPendente?: number | null;
                  Pagamentos?: Array<{ valor?: number }>;
              }
          )
        : { valorPago: 0, saldoPendente: 0 };

    const origemReserva = rh
        ? resolverOrigemReserva(
              rh as ReservaHospedagem & {
                  origemReserva?: 'SITE' | 'ATENDENTE' | 'CLIENTE' | null;
                  idUsuarioCriacao?: number | null;
                  formaPagamentoRecepcao?: string | null;
                  comprovantePagamento?: string | null;
                  observacaoPagamento?: string | null;
                  valorPago?: number;
              },
              financeiro.valorPago > 0
          )
        : null;

    return {
        id: suite.id,
        idEventoSuite: suite.id,
        nome: suite.nome,
        descricao: suite.descricao ?? null,
        idEvento: suite.idEvento,
        eventoNome: suite.Evento?.nome ?? null,
        status: statusOperacional,
        responsavel: rh?.Usuario?.nomeCompleto ?? null,
        telefone: rh?.Usuario?.telefone ?? null,
        checkin: rh?.checkin ?? null,
        checkout: rh?.checkout ?? null,
        dataHoraCheckinReal,
        adultos: reservaSuite ? Number(reservaSuite.adultos || 0) : 0,
        criancas: reservaSuite ? Number(reservaSuite.criancas || 0) : 0,
        valorHospedagem: rh ? toNumber(rh.valorTotal) : null,
        valorPago: rh ? financeiro.valorPago : null,
        saldoPendente: rh ? financeiro.saldoPendente : null,
        formaPagamentoRecepcao: rh
            ? (rh as ReservaHospedagem & {
                  formaPagamentoRecepcao?: string | null;
              }).formaPagamentoRecepcao ?? null
            : null,
        origemReserva,
        idUsuarioCriacao: rh
            ? (rh as ReservaHospedagem & {
                  idUsuarioCriacao?: number | null;
              }).idUsuarioCriacao ?? null
            : null,
        nomeUsuarioCriacao: rh
            ? (rh as ReservaHospedagem & {
                  UsuarioCriacao?: { nomeCompleto?: string | null };
              }).UsuarioCriacao?.nomeCompleto ?? null
            : null,
        dataCriacao: rh
            ? (rh as ReservaHospedagem & { createdAt?: Date }).createdAt ??
              rh.dataConfirmacao ??
              null
            : null,
        valorSuite: reservaSuite ? toNumber(reservaSuite.valorTotal) : null,
        idReservaHospedagem: rh?.id ?? null,
        numeroReserva: rh?.id ?? null,
        statusReserva: rh ? statusExibicaoReserva(rh.status, rh.checkout) : null,
        ocupadaAgora: flags.ocupadaAgora,
        hospedada: flags.hospedada,
        checkinHoje: flags.checkinHoje,
        checkoutHoje: flags.checkoutHoje,
        aguardandoPagamento: flags.aguardandoPagamento,
        disponivelHojeAposCheckout: disponivelAposCheckout,
        mensagemDisponibilidade:
            statusOperacional === 'CheckInHoje'
                ? `Entrada prevista às ${horarioCheckinPadrao}`
                : statusOperacional === 'Hospedada'
                  ? dataHoraCheckinReal
                      ? `Entrou às ${formatHoraCuiaba(dataHoraCheckinReal)}`
                      : 'Hóspede no estabelecimento'
                  : statusOperacional === 'CheckOutHoje'
                    ? `Sai às ${horarioCheckoutPadrao}`
                    : disponivelAposCheckout
                      ? `Disponível para nova reserva após ${horarioCheckoutPadrao}`
                      : statusOperacional === 'Livre'
                        ? 'Disponível para reserva'
                        : null,
        mensagemDisponibilidadeSecundaria:
            statusOperacional === 'Hospedada' && rh?.checkout
                ? `Sai em ${formatDataCurtaCuiaba(rh.checkout)} às ${horarioCheckoutPadrao}`
                : statusOperacional === 'CheckOutHoje'
                  ? 'Disponível após o check-out'
                  : disponivelAposCheckout
                    ? ref.ehHoje
                        ? 'Disponível hoje após check-out'
                        : 'Disponível após check-out nesta data'
                    : null,
        acoesDisponiveis: {
            verReserva: Boolean(rh?.id),
            reservar:
                statusOperacional === 'Livre' || disponivelAposCheckout,
            checkin: statusOperacional === 'CheckInHoje',
            checkout:
                statusOperacional === 'CheckOutHoje' ||
                statusOperacional === 'Hospedada',
            limpeza: false,
            manutencao: false,
            bloqueio: false,
            calendario: false,
        },
    };
}

function formatHoraCuiaba(d: Date | string): string {
    return formatInTimeZone(
        d instanceof Date ? d : new Date(d),
        TZ,
        'HH:mm'
    );
}

function formatDataCurtaCuiaba(d: Date | string): string {
    return formatInTimeZone(
        d instanceof Date ? d : new Date(d),
        TZ,
        'dd/MM'
    );
}

async function carregarReservasSuitesOperacionais(
    idsSuites: number[],
    mesInicio: Date,
    mesFim: Date
): Promise<ReservaSuiteComHospedagem[]> {
    return (await ReservaSuite.findAll({
        where: {
            idEventoSuite: { [Op.in]: idsSuites },
            status: {
                [Op.in]: [
                    StatusReservaHospedagem.Confirmada,
                    StatusReservaHospedagem.Hospedada,
                    StatusReservaHospedagem.AguardandoPagamento,
                ],
            },
        },
        include: [
            {
                model: ReservaHospedagem,
                as: 'ReservaHospedagem',
                required: true,
                where: {
                    status: {
                        [Op.in]: [
                            StatusReservaHospedagem.Confirmada,
                            StatusReservaHospedagem.Hospedada,
                            StatusReservaHospedagem.AguardandoPagamento,
                        ],
                    },
                    checkout: { [Op.gt]: mesInicio },
                    checkin: { [Op.lte]: mesFim },
                },
                include: [
                    {
                        model: Usuario,
                        as: 'Usuario',
                        attributes: ['nomeCompleto', 'telefone', 'email'],
                        required: false,
                    },
                    {
                        model: Usuario,
                        as: 'UsuarioCriacao',
                        attributes: ['id', 'nomeCompleto'],
                        required: false,
                    },
                    {
                        model: PagamentoHospedagem,
                        as: 'Pagamentos',
                        attributes: ['id', 'valor', 'formaPagamento'],
                        required: false,
                    },
                ],
            },
        ],
    })) as ReservaSuiteComHospedagem[];
}

function filtrarCardsOperacionais<
    T extends {
        status: StatusOperacionalSuite;
        ocupadaAgora?: boolean;
        hospedada?: boolean;
        checkinHoje?: boolean;
        checkoutHoje?: boolean;
        disponivelHojeAposCheckout?: boolean;
        aguardandoPagamento?: boolean;
    }
>(cards: T[], filtro: FiltroSuitesOperacional): T[] {
    switch (filtro) {
        case 'livres':
            return cards.filter(
                (c) =>
                    c.status === 'Livre' ||
                    c.checkoutHoje === true ||
                    c.disponivelHojeAposCheckout === true
            );
        case 'ocupadas':
        case 'hospedadas':
            return cards.filter(
                (c) =>
                    c.status === 'Hospedada' ||
                    c.hospedada === true ||
                    (c.ocupadaAgora === true && c.status !== 'CheckInHoje')
            );
        case 'checkin_hoje':
            return cards.filter(
                (c) =>
                    c.status === 'CheckInHoje' || c.checkinHoje === true
            );
        case 'checkout_hoje':
            return cards.filter(
                (c) =>
                    c.status === 'CheckOutHoje' || c.checkoutHoje === true
            );
        case 'aguardando_pagamento':
            return cards.filter(
                (c) =>
                    c.aguardandoPagamento === true ||
                    c.status === 'AguardandoPagamento'
            );
        case 'todas':
        case '':
        default:
            return cards;
    }
}

export async function listarSituacaoSuites(params: {
    idUsuario: number;
    filtro?: string;
    data?: string;
    mes?: string;
}) {
    const filtro = (params.filtro || 'todas') as FiltroSuitesOperacional;
    const ref = resolverDataReferencia(params.data);
    const mesStr = resolverMesReferencia(params.mes, ref.dataReferencia);
    const { inicio: mesInicio, fim: mesFim } = boundsMesCuiaba(mesStr);
    const escopo = await resolverEscopoProdutor(params.idUsuario);

    const eventoWhere: WhereOptions = {
        tipo: 'Pousada',
        ...(escopo.admGeral
            ? {}
            : { idProdutor: { [Op.in]: escopo.idsProdutor } }),
    };

    const suites = (await EventoSuite.findAll({
        where: {
            status: { [Op.in]: ['Ativo', 'PDV'] },
        },
        include: [
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'nome', 'idProdutor'],
                where: eventoWhere,
                required: true,
            },
        ],
        order: [['nome', 'ASC']],
    })) as Array<
        EventoSuite & { Evento?: { id: number; nome: string } | null }
    >;

    const nomesSuites = new Map(suites.map((s) => [s.id, s.nome]));
    const idsSuites = suites.map((s) => s.id);

    const reservasMes =
        idsSuites.length > 0
            ? await carregarReservasSuitesOperacionais(
                  idsSuites,
                  mesInicio,
                  mesFim
              )
            : [];

    if (filtro === 'manutencao' || filtro === 'bloqueadas') {
        return {
            data: [],
            meta: montarMetaSuitesOperacionais({
                filtro,
                total: 0,
                ref,
                mesStr,
                reservasMes,
                nomesSuites,
                idsSuites,
                mensagem:
                    filtro === 'manutencao'
                        ? 'Status Manutenção será habilitado em etapa futura.'
                        : 'Status Bloqueada será habilitado em etapa futura.',
            }),
        };
    }

    if (idsSuites.length === 0) {
        return {
            data: [],
            meta: montarMetaSuitesOperacionais({
                filtro,
                total: 0,
                ref,
                mesStr,
                reservasMes,
                nomesSuites,
                idsSuites,
            }),
        };
    }

    const porSuite = new Map<number, ReservaSuiteComHospedagem[]>();
    for (const item of reservasMes) {
        const rh = item.ReservaHospedagem;
        if (!rh || !reservaRelevanteNoDia(rh, ref)) continue;
        const lista = porSuite.get(item.idEventoSuite) ?? [];
        lista.push(item);
        porSuite.set(item.idEventoSuite, lista);
    }

    let cards = suites.map((suite) => {
        const relevante = escolherReservaRelevante(
            porSuite.get(suite.id) ?? [],
            ref
        );
        return mapearCardSuiteOperacional(suite, relevante, ref);
    });

    cards = filtrarCardsOperacionais(cards, filtro);

    return {
        data: cards,
        meta: montarMetaSuitesOperacionais({
            filtro,
            total: cards.length,
            ref,
            mesStr,
            reservasMes,
            nomesSuites,
            idsSuites,
        }),
    };
}

export async function obterSituacaoSuite(
    idEventoSuite: number,
    idUsuario: number,
    data?: string
) {
    const { data: cards } = await listarSituacaoSuites({
        idUsuario,
        filtro: 'todas',
        data,
    });
    const suite = cards.find((s) => s.idEventoSuite === idEventoSuite);
    if (!suite) {
        throw new CustomError('Suíte não encontrada.', 404, '');
    }
    return suite;
}

/** Check-in operacional: Confirmada → Hospedada. */
export async function realizarCheckinAdmin(
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
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                required: false,
            },
        ],
    })) as
        | (ReservaHospedagem & {
              Evento?: { id: number; idProdutor?: number } | null;
              ReservaSuite?: ReservaSuite[];
          })
        | null;

    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    if (
        !escopo.admGeral &&
        !escopo.idsProdutor.includes(Number(reserva.Evento?.idProdutor))
    ) {
        throw new CustomError(
            'Sem permissão para esta reserva.',
            403,
            ''
        );
    }

    if (reserva.status === StatusReservaHospedagem.Hospedada) {
        throw new CustomError('Check-in já realizado para esta reserva.', 400, '');
    }

    if (reserva.status !== StatusReservaHospedagem.Confirmada) {
        throw new CustomError(
            'Somente reservas confirmadas podem realizar check-in.',
            400,
            ''
        );
    }

    // data atual (Cuiabá) >= dia de check-in
    const hojeLocal = toZonedTime(new Date(), TZ);
    const checkinLocal = toZonedTime(new Date(reserva.checkin), TZ);
    const inicioHoje = startOfDay(hojeLocal);
    const inicioCheckin = startOfDay(checkinLocal);
    if (inicioHoje.getTime() < inicioCheckin.getTime()) {
        const dd = String(checkinLocal.getDate()).padStart(2, '0');
        const mm = String(checkinLocal.getMonth() + 1).padStart(2, '0');
        throw new CustomError(
            `Check-in disponível em ${dd}/${mm}.`,
            400,
            ''
        );
    }

    const agora = new Date();

    await connection.transaction(async (t: Transaction) => {
        await reserva.update(
            {
                status: StatusReservaHospedagem.Hospedada,
                dataHoraCheckinReal: agora,
                idUsuarioCheckin: idUsuario,
            },
            { transaction: t }
        );

        const suites = reserva.ReservaSuite ?? [];
        for (const suite of suites) {
            await suite.update(
                { status: StatusReservaSuite.Hospedada },
                { transaction: t }
            );
        }

        if (reserva.idTransacao) {
            await HistoricoTransacao.create(
                {
                    idTransacao: reserva.idTransacao,
                    idUsuario,
                    data: agora,
                    descricao: 'Check-in realizado',
                },
                { transaction: t }
            );
        }
    });

    return obterReservaAdminDetalhe(idReservaHospedagem, idUsuario);
}

/** Check-out operacional: Hospedada → CheckOutRealizado. */
export async function realizarCheckoutAdmin(
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
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                required: false,
            },
        ],
    })) as
        | (ReservaHospedagem & {
              Evento?: { id: number; idProdutor?: number } | null;
              ReservaSuite?: ReservaSuite[];
          })
        | null;

    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    if (
        !escopo.admGeral &&
        !escopo.idsProdutor.includes(Number(reserva.Evento?.idProdutor))
    ) {
        throw new CustomError(
            'Sem permissão para esta reserva.',
            403,
            ''
        );
    }

    if (reserva.status === StatusReservaHospedagem.CheckOutRealizado) {
        throw new CustomError(
            'Check-out já realizado para esta reserva.',
            400,
            ''
        );
    }

    if (reserva.status !== StatusReservaHospedagem.Hospedada) {
        throw new CustomError(
            'Somente reservas hospedadas podem realizar check-out.',
            400,
            ''
        );
    }

    const agora = new Date();

    await connection.transaction(async (t: Transaction) => {
        await reserva.update(
            {
                status: StatusReservaHospedagem.CheckOutRealizado,
                dataHoraCheckoutRealizado: agora,
                idUsuarioCheckout: idUsuario,
            },
            { transaction: t }
        );

        const suites = reserva.ReservaSuite ?? [];
        for (const suite of suites) {
            await suite.update(
                { status: StatusReservaSuite.CheckOutRealizado },
                { transaction: t }
            );
        }

        if (reserva.idTransacao) {
            await HistoricoTransacao.create(
                {
                    idTransacao: reserva.idTransacao,
                    idUsuario,
                    data: agora,
                    descricao: 'Check-out realizado.',
                },
                { transaction: t }
            );
        }
    });

    return obterReservaAdminDetalhe(idReservaHospedagem, idUsuario);
}

/** Reserva manual da recepção: Confirmada + notificação (reusa checkoutHospedagem). */
export async function criarReservaRecepcaoAdmin(params: {
    idUsuarioOperador: number;
    idEvento: number;
    idUsuarioCliente: number;
    checkin: Date;
    checkout: Date;
    suites: import('./reservaSuiteService').SuiteCheckoutItem[];
    observacoes?: string | null;
    pagamento?: import('../utils/hospedagemPagamentoRecepcao').PagamentoRecepcaoInput | null;
}) {
    const escopo = await resolverEscopoProdutor(params.idUsuarioOperador);

    const evento = await Evento.findByPk(params.idEvento, {
        attributes: ['id', 'idProdutor', 'tipo'],
    });
    if (!evento || (evento as Evento & { tipo?: string }).tipo !== 'Pousada') {
        throw new CustomError('Evento de pousada não encontrado.', 404, '');
    }
    if (
        !escopo.admGeral &&
        !escopo.idsProdutor.includes(Number(evento.idProdutor))
    ) {
        throw new CustomError(
            'Sem permissão para criar reserva neste evento.',
            403,
            ''
        );
    }

    const { checkoutHospedagem } = await import('./reservaSuiteService');

    const resultado = await checkoutHospedagem({
        idEvento: params.idEvento,
        idUsuario: params.idUsuarioCliente,
        checkin: params.checkin,
        checkout: params.checkout,
        suites: params.suites,
        origem: 'recepcao',
        observacoes: params.observacoes,
        idUsuarioOperador: params.idUsuarioOperador,
        pagamento: params.pagamento ?? null,
    });

    return obterReservaAdminDetalhe(
        resultado.hospedagem.id,
        params.idUsuarioOperador
    );
}
