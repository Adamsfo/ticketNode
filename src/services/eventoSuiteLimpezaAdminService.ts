import { Op, Transaction, WhereOptions } from 'sequelize';
import connection from '../database';
import { Evento } from '../models/Evento';
import { EventoSuite } from '../models/EventoSuite';
import {
    EventoSuiteLimpeza,
    StatusEventoSuiteLimpeza,
    podeConcluirLimpeza,
    podeIniciarLimpeza,
} from '../models/EventoSuiteLimpeza';
import { ReservaHospedagem } from '../models/ReservaHospedagem';
import { ProdutorAcesso } from '../models/Produtor';
import { Usuario } from '../models/Usuario';
import { CustomError } from '../utils/customError';

export type FiltroLimpezaSuites =
    | 'todas'
    | 'pendente'
    | 'em_andamento'
    | 'concluida'
    | '';

function resolverFiltroStatus(
    filtro: string
): StatusEventoSuiteLimpeza[] | null {
    switch (String(filtro || '').toLowerCase()) {
        case 'pendente':
            return [StatusEventoSuiteLimpeza.Pendente];
        case 'em_andamento':
            return [StatusEventoSuiteLimpeza.EmAndamento];
        case 'concluida':
            return [StatusEventoSuiteLimpeza.Concluida];
        default:
            return null;
    }
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

function isoOrNull(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type EscopoProdutor = {
    admGeral: boolean;
    idsProdutor: number[];
};

function eventoWhereEscopo(escopo: EscopoProdutor): WhereOptions {
    return escopo.admGeral
        ? {}
        : { idProdutor: { [Op.in]: escopo.idsProdutor } };
}

const includeLimpezaDetalhe = (eventoWhere: WhereOptions) => [
    {
        model: EventoSuite,
        as: 'EventoSuite',
        required: true,
        attributes: ['id', 'nome'],
        include: [
            {
                model: Evento,
                as: 'Evento',
                required: true,
                attributes: ['id', 'nome'],
                where: eventoWhere,
            },
        ],
    },
    {
        model: ReservaHospedagem,
        as: 'ReservaHospedagem',
        required: true,
        attributes: [
            'id',
            'checkin',
            'checkout',
            'dataHoraCheckoutRealizado',
            'status',
        ],
        include: [
            {
                model: Usuario,
                as: 'Usuario',
                attributes: ['id', 'nomeCompleto'],
                required: false,
            },
        ],
    },
    {
        model: Usuario,
        as: 'UsuarioInicio',
        attributes: ['id', 'nomeCompleto'],
        required: false,
    },
    {
        model: Usuario,
        as: 'UsuarioFim',
        attributes: ['id', 'nomeCompleto'],
        required: false,
    },
];

function mapearLimpezaCard(row: EventoSuiteLimpeza) {
    const suite = (
        row as EventoSuiteLimpeza & {
            EventoSuite?: EventoSuite & {
                Evento?: { id: number; nome: string } | null;
            };
        }
    ).EventoSuite;
    const rh = (
        row as EventoSuiteLimpeza & {
            ReservaHospedagem?: ReservaHospedagem & {
                Usuario?: { nomeCompleto?: string | null } | null;
            };
        }
    ).ReservaHospedagem;
    const usuarioInicio = (
        row as EventoSuiteLimpeza & {
            UsuarioInicio?: { nomeCompleto?: string | null } | null;
        }
    ).UsuarioInicio;
    const usuarioFim = (
        row as EventoSuiteLimpeza & {
            UsuarioFim?: { nomeCompleto?: string | null } | null;
        }
    ).UsuarioFim;

    return {
        id: row.id,
        idEventoSuite: row.idEventoSuite,
        nomeSuite: suite?.nome ?? null,
        idReservaHospedagem: row.idReservaHospedagem,
        numeroReserva: row.idReservaHospedagem,
        hospede: rh?.Usuario?.nomeCompleto ?? null,
        status: row.status,
        checkin: isoOrNull(rh?.checkin),
        checkout: isoOrNull(rh?.checkout),
        dataHoraCheckoutRealizado: isoOrNull(rh?.dataHoraCheckoutRealizado),
        dataHoraInicio: isoOrNull(row.dataHoraInicio),
        dataHoraFim: isoOrNull(row.dataHoraFim),
        usuarioInicio: usuarioInicio?.nomeCompleto ?? null,
        usuarioFim: usuarioFim?.nomeCompleto ?? null,
        eventoNome: suite?.Evento?.nome ?? null,
        statusReserva: rh?.status ?? null,
        createdAt: isoOrNull(row.createdAt),
        updatedAt: isoOrNull(row.updatedAt),
    };
}

async function carregarLimpezaNoEscopo(
    idLimpeza: number,
    escopo: EscopoProdutor,
    transaction?: Transaction,
    lock?: boolean
): Promise<EventoSuiteLimpeza> {
    const eventoWhere = eventoWhereEscopo(escopo);
    const limpeza = await EventoSuiteLimpeza.findOne({
        where: { id: idLimpeza },
        include: includeLimpezaDetalhe(eventoWhere),
        transaction,
        ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
    });

    if (!limpeza) {
        throw new CustomError(
            'Limpeza não encontrada ou sem permissão.',
            404,
            ''
        );
    }

    return limpeza;
}

export function validarInicioLimpeza(status: string): void {
    if (!podeIniciarLimpeza(status)) {
        if (status === StatusEventoSuiteLimpeza.Concluida) {
            throw new CustomError(
                'Limpeza já concluída não pode ser iniciada novamente.',
                400,
                ''
            );
        }
        throw new CustomError(
            'Somente limpezas pendentes podem ser iniciadas.',
            400,
            ''
        );
    }
}

export function validarConclusaoLimpeza(status: string): void {
    if (!podeConcluirLimpeza(status)) {
        if (status === StatusEventoSuiteLimpeza.Pendente) {
            throw new CustomError(
                'Limpeza pendente deve ser iniciada antes de ser concluída.',
                400,
                ''
            );
        }
        throw new CustomError(
            'Somente limpezas em andamento podem ser concluídas.',
            400,
            ''
        );
    }
}

export async function iniciarLimpezaSuiteAdmin(
    idLimpeza: number,
    idUsuario: number
) {
    const escopo = await resolverEscopoProdutor(idUsuario);

    await connection.transaction(async (t: Transaction) => {
        const limpeza = await carregarLimpezaNoEscopo(
            idLimpeza,
            escopo,
            t,
            true
        );
        validarInicioLimpeza(limpeza.status);

        const agora = new Date();
        await limpeza.update(
            {
                status: StatusEventoSuiteLimpeza.EmAndamento,
                dataHoraInicio: agora,
                idUsuarioInicio: idUsuario,
            },
            { transaction: t }
        );
    });

    const atualizada = await carregarLimpezaNoEscopo(idLimpeza, escopo);
    return mapearLimpezaCard(atualizada);
}

export async function concluirLimpezaSuiteAdmin(
    idLimpeza: number,
    idUsuario: number
) {
    const escopo = await resolverEscopoProdutor(idUsuario);

    await connection.transaction(async (t: Transaction) => {
        const limpeza = await carregarLimpezaNoEscopo(
            idLimpeza,
            escopo,
            t,
            true
        );
        validarConclusaoLimpeza(limpeza.status);

        const agora = new Date();
        await limpeza.update(
            {
                status: StatusEventoSuiteLimpeza.Concluida,
                dataHoraFim: agora,
                idUsuarioFim: idUsuario,
            },
            { transaction: t }
        );
    });

    const atualizada = await carregarLimpezaNoEscopo(idLimpeza, escopo);
    return mapearLimpezaCard(atualizada);
}

export async function listarLimpezasSuitesAdmin(params: {
    idUsuario: number;
    filtro?: FiltroLimpezaSuites | string;
    page?: number;
    pageSize?: number;
}) {
    const escopo = await resolverEscopoProdutor(params.idUsuario);
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 30));
    const filtro = String(params.filtro || 'todas').toLowerCase() as FiltroLimpezaSuites;
    const statuses = resolverFiltroStatus(filtro);

    const whereLimpeza: WhereOptions = {};
    if (statuses) {
        whereLimpeza.status = { [Op.in]: statuses };
    }

    const eventoWhere: WhereOptions = escopo.admGeral
        ? {}
        : { idProdutor: { [Op.in]: escopo.idsProdutor } };

    const { rows, count } = await EventoSuiteLimpeza.findAndCountAll({
        where: whereLimpeza,
        include: includeLimpezaDetalhe(eventoWhere),
        order: [['createdAt', 'DESC']],
        limit: pageSize,
        offset: (page - 1) * pageSize,
        distinct: true,
    });

    const data = rows.map((row) => mapearLimpezaCard(row));

    const totalPages = Math.max(1, Math.ceil(count / pageSize));

    return {
        data,
        meta: {
            page,
            pageSize,
            total: count,
            totalPages,
            hasMore: page < totalPages,
            filtro: filtro || 'todas',
        },
    };
}
