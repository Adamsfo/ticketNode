import { Op } from 'sequelize';
import {
    ReservaHospedagem,
    StatusReservaHospedagem,
} from '../models/ReservaHospedagem';
import { ReservaSuite } from '../models/ReservaSuite';
import { ReservaHospede } from '../models/ReservaHospede';
import { Evento } from '../models/Evento';
import { EventoSuite } from '../models/EventoSuite';
import { PagamentoHospedagem } from '../models/PagamentoHospedagem';
import { CustomError } from '../utils/customError';
import { assertUsuarioDonoReservaPublica } from './reservaSuiteService';
import {
    montarCancelamentoClienteDto,
    type CancelamentoClienteDto,
} from './hospedagemCancelamentoClienteService';
import type { PagamentoHospedagemResumo } from './hospedagemCancelamentoClientePolicy';

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

export type FiltroStatusMinhasReservas =
    | 'confirmadas'
    | 'hospedadas'
    | 'canceladas';

export type MinhaReservaCardDto = {
    id: number;
    numeroReserva: number;
    status: string;
    evento: { id: number; nome: string } | null;
    nomeSuite: string;
    suites: Array<{ nome: string; adultos: number; criancas: number }>;
    checkin: Date | string;
    checkout: Date | string;
    noites: number;
    adultos: number;
    criancas: number;
    valorTotal: number;
    valorPago: number;
    saldoPendente: number;
    origemReserva: string | null;
    dataCriacao: Date | string | null;
    dataConfirmacao: Date | string | null;
    podeCancelar: boolean;
    motivoBloqueio: string | null;
    percentualDevolucao: 50 | 100 | null;
    valorDevolucao: number | null;
};

export type SituacaoFinanceiraMinhaReserva =
    | 'Quitada'
    | 'Parcial'
    | 'Pendente';

export type MinhaReservaDetalheDto = {
    id: number;
    numeroReserva: number;
    status: string;
    dataCriacao: Date | string | null;
    dataConfirmacao: Date | string | null;
    checkin: Date | string;
    checkout: Date | string;
    noites: number;
    preco: number;
    taxaServico: number;
    evento: {
        id: number;
        nome: string;
        imagem: string | null;
    };
    suites: Array<{
        idReservaSuite: number;
        idEventoSuite: number;
        nome: string;
        adultos: number;
        criancas: number;
        hospedes: Array<{
            nome: string;
            tipo: string;
            dataNascimento: string | null;
        }>;
    }>;
    financeiro: {
        valorTotal: number;
        valorPago: number;
        saldoPendente: number;
        situacaoFinanceira: SituacaoFinanceiraMinhaReserva;
    };
    podeContinuarPagamento: boolean;
    tokenPagamento: string | null;
    cancelamento: CancelamentoClienteDto;
};

type ReservaMinhasIncludes = ReservaHospedagem & {
    Evento?: { id: number; nome: string } | null;
    ReservaSuite?: Array<
        ReservaSuite & {
            EventoSuite?: { id: number; nome: string } | null;
        }
    >;
    createdAt?: Date;
};

type ReservaDetalheIncludes = ReservaHospedagem & {
    Evento?: { id: number; nome: string; imagem?: string | null } | null;
    ReservaSuite?: Array<
        ReservaSuite & {
            EventoSuite?: { id: number; nome: string } | null;
            ReservaHospede?: Array<{
                nome: string;
                tipo: string;
                dataNascimento?: Date | string | null;
            }>;
        }
    >;
    createdAt?: Date;
};

export function parseFiltroStatusMinhasReservas(
    raw: unknown
): FiltroStatusMinhasReservas {
    const valor = String(raw ?? 'confirmadas')
        .trim()
        .toLowerCase();

    if (valor === 'hospedadas') return 'hospedadas';
    if (valor === 'canceladas') return 'canceladas';
    if (valor === 'confirmadas') return 'confirmadas';

    throw new CustomError(
        'status inválido. Use confirmadas, hospedadas ou canceladas.',
        400,
        ''
    );
}

export function statusBancoPorFiltroMinhasReservas(
    filtro: FiltroStatusMinhasReservas
): StatusReservaHospedagem {
    switch (filtro) {
        case 'confirmadas':
            return StatusReservaHospedagem.Confirmada;
        case 'hospedadas':
            return StatusReservaHospedagem.Hospedada;
        case 'canceladas':
            return StatusReservaHospedagem.Cancelada;
        default:
            return StatusReservaHospedagem.Confirmada;
    }
}

function toNumber(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

export function resolverSituacaoFinanceiraMinhaReserva(
    valorTotal: number,
    valorPago: number,
    saldoPendente: number
): SituacaoFinanceiraMinhaReserva {
    if (saldoPendente <= 0.009) {
        return 'Quitada';
    }
    if (valorPago > 0) {
        return 'Parcial';
    }
    return 'Pendente';
}

function mapearPagamentosResumo(
    pagamentos: PagamentoHospedagem[]
): PagamentoHospedagemResumo[] {
    return pagamentos.map((item) => ({
        id: item.id,
        valor: toNumber(item.valor),
        formaPagamento: item.formaPagamento,
        comprovante: item.comprovante ?? null,
    }));
}

async function carregarPagamentosPorReservas(
    idsReserva: number[]
): Promise<Map<number, PagamentoHospedagemResumo[]>> {
    const mapa = new Map<number, PagamentoHospedagemResumo[]>();
    if (!idsReserva.length) {
        return mapa;
    }

    const pagamentos = await PagamentoHospedagem.findAll({
        where: { idReservaHospedagem: { [Op.in]: idsReserva } },
        order: [['id', 'ASC']],
    });

    for (const pagamento of pagamentos) {
        const idReserva = Number(pagamento.idReservaHospedagem);
        const lista = mapa.get(idReserva) ?? [];
        lista.push({
            id: pagamento.id,
            valor: toNumber(pagamento.valor),
            formaPagamento: pagamento.formaPagamento,
            comprovante: pagamento.comprovante ?? null,
        });
        mapa.set(idReserva, lista);
    }

    return mapa;
}

export function mapearMinhaReservaDetalhe(
    reserva: ReservaDetalheIncludes,
    pagamentos: PagamentoHospedagemResumo[] = []
): MinhaReservaDetalheDto {
    const valorTotal = toNumber(reserva.valorTotal);
    const valorPago = toNumber(reserva.valorPago ?? 0);
    const saldoPendente =
        reserva.saldoPendente != null
            ? toNumber(reserva.saldoPendente)
            : Math.max(0, valorTotal - valorPago);

    const suitesDb = reserva.ReservaSuite ?? [];
    const suites = suitesDb.map((suite) => ({
        idReservaSuite: suite.id,
        idEventoSuite: Number(suite.idEventoSuite || 0),
        nome:
            suite.EventoSuite?.nome ??
            (suite.idEventoSuite ? `Suíte ${suite.idEventoSuite}` : 'Suíte'),
        adultos: Number(suite.adultos || 0),
        criancas: Number(suite.criancas || 0),
        hospedes: (suite.ReservaHospede ?? []).map((hospede) => ({
            nome: String(hospede.nome ?? '').trim() || 'Hóspede',
            tipo: String(hospede.tipo ?? 'Adulto'),
            dataNascimento: hospede.dataNascimento
                ? String(hospede.dataNascimento)
                : null,
        })),
    }));

    const status = String(reserva.status);
    const tokenPagamento = reserva.tokenPagamento
        ? String(reserva.tokenPagamento)
        : null;
    const podeContinuarPagamento =
        status === StatusReservaHospedagem.AguardandoPagamento &&
        Boolean(tokenPagamento);

    return {
        id: reserva.id,
        numeroReserva: reserva.id,
        status,
        dataCriacao: reserva.createdAt ?? null,
        dataConfirmacao: reserva.dataConfirmacao ?? null,
        checkin: reserva.checkin,
        checkout: reserva.checkout,
        noites: Number(reserva.noites || 0),
        preco: toNumber(reserva.preco),
        taxaServico: toNumber(reserva.taxaServico),
        evento: {
            id: reserva.Evento?.id ?? Number(reserva.idEvento || 0),
            nome: reserva.Evento?.nome ?? 'Pousada',
            imagem: reserva.Evento?.imagem ?? null,
        },
        suites,
        financeiro: {
            valorTotal,
            valorPago,
            saldoPendente,
            situacaoFinanceira: resolverSituacaoFinanceiraMinhaReserva(
                valorTotal,
                valorPago,
                saldoPendente
            ),
        },
        podeContinuarPagamento,
        tokenPagamento: podeContinuarPagamento ? tokenPagamento : null,
        cancelamento: montarCancelamentoClienteDto(reserva, pagamentos),
    };
}

export function mapearMinhaReservaCard(
    reserva: ReservaMinhasIncludes,
    pagamentos: PagamentoHospedagemResumo[] = []
): MinhaReservaCardDto {
    const suitesDb = reserva.ReservaSuite ?? [];
    const suites = suitesDb.map((suite) => ({
        nome:
            suite.EventoSuite?.nome ??
            (suite.idEventoSuite ? `Suíte ${suite.idEventoSuite}` : 'Suíte'),
        adultos: Number(suite.adultos || 0),
        criancas: Number(suite.criancas || 0),
    }));

    const adultos = suites.reduce((acc, s) => acc + s.adultos, 0);
    const criancas = suites.reduce((acc, s) => acc + s.criancas, 0);
    const valorTotal = toNumber(reserva.valorTotal);
    const valorPago = toNumber(reserva.valorPago ?? 0);
    const saldoPendente =
        reserva.saldoPendente != null
            ? toNumber(reserva.saldoPendente)
            : Math.max(0, valorTotal - valorPago);

    return {
        id: reserva.id,
        numeroReserva: reserva.id,
        status: String(reserva.status),
        evento: reserva.Evento
            ? { id: reserva.Evento.id, nome: reserva.Evento.nome }
            : null,
        nomeSuite: suites[0]?.nome ?? 'Suíte',
        suites,
        checkin: reserva.checkin,
        checkout: reserva.checkout,
        noites: Number(reserva.noites || 0),
        adultos,
        criancas,
        valorTotal,
        valorPago,
        saldoPendente,
        origemReserva: reserva.origemReserva
            ? String(reserva.origemReserva)
            : null,
        dataCriacao: reserva.createdAt ?? null,
        dataConfirmacao: reserva.dataConfirmacao ?? null,
        ...(() => {
            const cancelamento = montarCancelamentoClienteDto(reserva, pagamentos);
            return {
                podeCancelar: cancelamento.podeCancelar,
                motivoBloqueio: cancelamento.motivoBloqueio,
                percentualDevolucao: cancelamento.percentualDevolucao,
                valorDevolucao: cancelamento.valorDevolucao,
            };
        })(),
    };
}

export async function listarMinhasReservas(params: {
    idUsuario: number;
    status?: unknown;
    page?: number;
    pageSize?: number;
}) {
    const idUsuario = Number(params.idUsuario);
    if (!Number.isFinite(idUsuario) || idUsuario <= 0) {
        throw new CustomError('Usuário não autenticado.', 401, '');
    }

    const filtroStatus = parseFiltroStatusMinhasReservas(params.status);
    const statusBanco = statusBancoPorFiltroMinhasReservas(filtroStatus);
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(
        PAGE_SIZE_MAX,
        Math.max(1, Number(params.pageSize) || PAGE_SIZE_DEFAULT)
    );

    const { rows, count } = await ReservaHospedagem.findAndCountAll({
        where: {
            idUsuario,
            status: statusBanco,
        },
        include: [
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'nome'],
                required: false,
            },
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                attributes: ['id', 'idEventoSuite', 'adultos', 'criancas'],
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
        order: [['id', 'DESC']],
        limit: pageSize,
        offset: (page - 1) * pageSize,
        distinct: true,
        subQuery: false,
    });

    const idsReserva = (rows as ReservaMinhasIncludes[]).map((item) => item.id);
    const pagamentosPorReserva = await carregarPagamentosPorReservas(idsReserva);
    const data = (rows as ReservaMinhasIncludes[]).map((reserva) =>
        mapearMinhaReservaCard(
            reserva,
            pagamentosPorReserva.get(reserva.id) ?? []
        )
    );
    const totalPages = Math.max(1, Math.ceil(count / pageSize));

    return {
        data,
        meta: {
            page,
            pageSize,
            total: count,
            totalPages,
            hasMore: page < totalPages,
            status: filtroStatus,
        },
    };
}

export async function obterMinhaReservaDetalhe(
    idReserva: number,
    idUsuarioJwt: number
): Promise<MinhaReservaDetalheDto> {
    const id = Number(idReserva);
    const idUsuario = Number(idUsuarioJwt);

    if (!Number.isFinite(id) || id <= 0) {
        throw new CustomError('id da reserva é obrigatório.', 400, '');
    }
    if (!Number.isFinite(idUsuario) || idUsuario <= 0) {
        throw new CustomError('Usuário não autenticado.', 401, '');
    }

    const reserva = (await ReservaHospedagem.findOne({
        where: { id },
        include: [
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'nome', 'imagem'],
                required: false,
            },
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                attributes: ['id', 'idEventoSuite', 'adultos', 'criancas'],
                required: false,
                include: [
                    {
                        model: EventoSuite,
                        as: 'EventoSuite',
                        attributes: ['id', 'nome'],
                        required: false,
                    },
                    {
                        model: ReservaHospede,
                        as: 'ReservaHospede',
                        attributes: ['nome', 'tipo', 'dataNascimento'],
                        required: false,
                        separate: true,
                        order: [['id', 'ASC']],
                    },
                ],
            },
        ],
    })) as ReservaDetalheIncludes | null;

    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    assertUsuarioDonoReservaPublica(reserva, idUsuario);

    const pagamentos = await PagamentoHospedagem.findAll({
        where: { idReservaHospedagem: id },
        order: [['id', 'ASC']],
    });

    return mapearMinhaReservaDetalhe(
        reserva,
        mapearPagamentosResumo(pagamentos)
    );
}
