import { Op, Transaction, WhereOptions } from 'sequelize';
import connection from '../database';
import { Evento } from '../models/Evento';
import { EventoSuite } from '../models/EventoSuite';
import {
    EventoSuiteLimpeza,
    OrigemEventoSuiteLimpeza,
    StatusEventoSuiteLimpeza,
    podeConcluirLimpeza,
    podeIniciarLimpeza,
} from '../models/EventoSuiteLimpeza';
import {
    assertNenhumaLimpezaAbertaNaSuite,
    buscarLimpezaAbertaNaSuite,
} from './eventoSuiteLimpezaCheckinService';
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

export type LimpezaSituacaoAtualInput = {
    id: number;
    idEventoSuite: number;
    status: StatusEventoSuiteLimpeza | string;
    createdAt: Date;
};

/** Status permitidos após selecionar a tarefa mais recente de cada suíte. */
export function resolverFiltroSituacaoAtual(
    filtro: string
): StatusEventoSuiteLimpeza[] | null {
    switch (String(filtro || '').toLowerCase()) {
        case 'pendente':
            return [
                StatusEventoSuiteLimpeza.Pendente,
                StatusEventoSuiteLimpeza.EmAndamento,
            ];
        case 'em_andamento':
            return [StatusEventoSuiteLimpeza.EmAndamento];
        case 'concluida':
            return [StatusEventoSuiteLimpeza.Concluida];
        default:
            return null;
    }
}

/** Uma tarefa por idEventoSuite — a mais recente por createdAt DESC. */
export function selecionarTarefasAtuaisPorSuite<T extends LimpezaSituacaoAtualInput>(
    rows: T[]
): T[] {
    const ordenadas = [...rows].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    const visto = new Set<number>();
    const resultado: T[] = [];

    for (const row of ordenadas) {
        const idSuite = Number(row.idEventoSuite);
        if (!Number.isFinite(idSuite) || idSuite <= 0 || visto.has(idSuite)) {
            continue;
        }
        visto.add(idSuite);
        resultado.push(row);
    }

    return resultado;
}

export function filtrarTarefasAtuaisPorFiltro<T extends { status: string }>(
    tarefas: T[],
    filtro: string
): T[] {
    const statuses = resolverFiltroSituacaoAtual(filtro);
    if (!statuses) return tarefas;
    const permitidos = new Set(statuses.map(String));
    return tarefas.filter((t) => permitidos.has(String(t.status)));
}

/** Ordenação da aba Concluídas: dataHoraFim DESC; NULL por último; desempate id DESC. */
export function ordenarTarefasConcluidasPorDataHoraFim<
    T extends { id: number; dataHoraFim?: Date | null },
>(tarefas: T[]): T[] {
    return [...tarefas].sort((a, b) => {
        const ta = a.dataHoraFim?.getTime();
        const tb = b.dataHoraFim?.getTime();
        const aInvalid = ta == null || Number.isNaN(ta);
        const bInvalid = tb == null || Number.isNaN(tb);

        if (aInvalid && bInvalid) {
            return b.id - a.id;
        }
        if (aInvalid) return 1;
        if (bInvalid) return -1;
        if (tb !== ta) return tb - ta;
        return b.id - a.id;
    });
}

export function paginarTarefasAtuais<T>(
    tarefas: T[],
    page: number,
    pageSize: number
): {
    data: T[];
    total: number;
    totalPages: number;
    hasMore: boolean;
} {
    const pagina = Math.max(1, Number(page) || 1);
    const tamanho = Math.min(100, Math.max(1, Number(pageSize) || 30));
    const total = tarefas.length;
    const offset = (pagina - 1) * tamanho;
    const data = tarefas.slice(offset, offset + tamanho);
    const totalPages = Math.max(1, Math.ceil(total / tamanho));

    return {
        data,
        total,
        totalPages,
        hasMore: pagina < totalPages,
    };
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
        required: false,
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

    const origem = row.origem ?? OrigemEventoSuiteLimpeza.Checkout;
    const manual = origem === OrigemEventoSuiteLimpeza.Manual;

    return {
        id: row.id,
        idEventoSuite: row.idEventoSuite,
        nomeSuite: suite?.nome ?? null,
        origem,
        idReservaHospedagem: row.idReservaHospedagem,
        numeroReserva: manual ? null : row.idReservaHospedagem,
        hospede: manual ? null : rh?.Usuario?.nomeCompleto ?? null,
        status: row.status,
        checkin: isoOrNull(rh?.checkin),
        checkout: isoOrNull(rh?.checkout),
        dataHoraCheckoutRealizado: isoOrNull(rh?.dataHoraCheckoutRealizado),
        dataHoraInicio: isoOrNull(row.dataHoraInicio),
        dataHoraFim: isoOrNull(row.dataHoraFim),
        usuarioInicio: usuarioInicio?.nomeCompleto ?? null,
        usuarioFim: usuarioFim?.nomeCompleto ?? null,
        eventoNome: suite?.Evento?.nome ?? null,
        statusReserva: manual ? null : rh?.status ?? null,
        createdAt: isoOrNull(row.createdAt),
        updatedAt: isoOrNull(row.updatedAt),
    };
}

async function carregarSuiteAtivaNoEscopo(
    idEventoSuite: number,
    escopo: EscopoProdutor,
    transaction: Transaction
): Promise<EventoSuite> {
    const eventoWhere = eventoWhereEscopo(escopo);
    const suite = await EventoSuite.findOne({
        where: { id: idEventoSuite, status: 'Ativo' },
        include: [
            {
                model: Evento,
                as: 'Evento',
                required: true,
                attributes: ['id', 'nome', 'idProdutor'],
                where: eventoWhere,
            },
        ],
        transaction,
        lock: transaction.LOCK.UPDATE,
    });

    if (!suite) {
        throw new CustomError(
            'Suíte não encontrada, inativa ou sem permissão.',
            404,
            ''
        );
    }

    return suite;
}

/**
 * Cria limpeza MANUAL Pendente na transaction recebida.
 * Idempotente por suíte: não duplica se já existir Pendente/EmAndamento.
 */
export async function criarLimpezaManualPendenteSeAusente(
    idEventoSuite: number,
    transaction: Transaction
): Promise<boolean> {
    const idSuite = Number(idEventoSuite);
    if (!Number.isFinite(idSuite) || idSuite <= 0) {
        return false;
    }

    const suite = await EventoSuite.findByPk(idSuite, {
        transaction,
        lock: transaction.LOCK.UPDATE,
    });
    if (!suite) {
        return false;
    }

    const limpezaAberta = await buscarLimpezaAbertaNaSuite(idSuite, {
        transaction,
        lock: true,
    });
    if (limpezaAberta) {
        return false;
    }

    await EventoSuiteLimpeza.create(
        {
            idEventoSuite: idSuite,
            idReservaHospedagem: null,
            idReservaSuite: null,
            origem: OrigemEventoSuiteLimpeza.Manual,
            status: StatusEventoSuiteLimpeza.Pendente,
        },
        { transaction }
    );

    return true;
}

export async function criarLimpezaManualSuiteAdmin(
    idEventoSuite: number,
    idUsuario: number
) {
    const idSuite = Number(idEventoSuite);
    if (!Number.isFinite(idSuite) || idSuite <= 0) {
        throw new CustomError('idEventoSuite é obrigatório.', 400, '');
    }

    const escopo = await resolverEscopoProdutor(idUsuario);
    let idLimpezaCriada = 0;

    await connection.transaction(async (t: Transaction) => {
        await carregarSuiteAtivaNoEscopo(idSuite, escopo, t);
        await assertNenhumaLimpezaAbertaNaSuite(idSuite, {
            transaction: t,
            lock: true,
        });

        const limpeza = await EventoSuiteLimpeza.create(
            {
                idEventoSuite: idSuite,
                idReservaHospedagem: null,
                idReservaSuite: null,
                origem: OrigemEventoSuiteLimpeza.Manual,
                status: StatusEventoSuiteLimpeza.Pendente,
            },
            { transaction: t }
        );

        idLimpezaCriada = limpeza.id;
    });

    const criada = await carregarLimpezaNoEscopo(idLimpezaCriada, escopo);
    return mapearLimpezaCard(criada);
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

    const eventoWhere: WhereOptions = escopo.admGeral
        ? {}
        : { idProdutor: { [Op.in]: escopo.idsProdutor } };

    const rows = await EventoSuiteLimpeza.findAll({
        include: includeLimpezaDetalhe(eventoWhere),
        order: [['createdAt', 'DESC']],
    });

    const atuais = selecionarTarefasAtuaisPorSuite(rows);
    let filtradas = filtrarTarefasAtuaisPorFiltro(atuais, filtro);
    if (filtro === 'concluida') {
        filtradas = ordenarTarefasConcluidasPorDataHoraFim(filtradas);
    }
    const paginado = paginarTarefasAtuais(filtradas, page, pageSize);
    const data = paginado.data.map((row) => mapearLimpezaCard(row));

    return {
        data,
        meta: {
            page,
            pageSize,
            total: paginado.total,
            totalPages: paginado.totalPages,
            hasMore: paginado.hasMore,
            filtro: filtro || 'todas',
        },
    };
}
