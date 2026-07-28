import { Op } from 'sequelize';
import { EventoSuite } from '../models/EventoSuite';
import { Evento } from '../models/Evento';
import { CupomPromocional } from '../models/CupomPromocional';
import { ReservaSuite } from '../models/ReservaSuite';
import { ReservaSuiteMovimentacao } from '../models/ReservaSuiteMovimentacao';
import { EventoSuiteTransacao } from '../models/Transacao';
import { HospedinPlaceSuiteMap } from '../models/HospedinPlaceSuiteMap';
import { EventoSuiteFoto } from '../models/EventoSuiteFoto';
import { Usuario } from '../models/Usuario';
import { ProdutorAcesso } from '../models/Produtor';
import { CustomError } from '../utils/customError';

export const EVENTO_SUITE_STATUS = [
    'Ativo',
    'Oculto',
    'Finalizado',
    'PDV',
] as const;

export type EventoSuiteStatus = (typeof EVENTO_SUITE_STATUS)[number];

export type EventoSuiteCreateInput = {
    nome: string;
    descricao?: string | null;
    idEvento: number;
    qtdeMinimaPessoas: number;
    qtdeMaximaPessoas: number;
    preco: number;
    taxaServico: number;
    valor: number;
    status?: EventoSuiteStatus | string;
    idCupomPromocional?: number | null;
};

export type EventoSuiteUpdateInput = Partial<{
    nome: string;
    descricao: string | null;
    idEvento: number;
    qtdeMinimaPessoas: number;
    qtdeMaximaPessoas: number;
    preco: number;
    taxaServico: number;
    valor: number;
    status: EventoSuiteStatus | string;
    idCupomPromocional: number | null;
}>;

export type EventoSuiteListParams = {
    idEvento?: number;
    page?: number;
    pageSize?: number;
    search?: string;
};

type EscopoProdutor = {
    admGeral: boolean;
    idsProdutor: number[];
};

const MSG_DELETE_BLOQUEADO =
    'Esta suíte não pode ser excluída porque possui histórico vinculado (reservas, movimentações, transações ou mapeamento Hospedin). Altere o status para Finalizado.';

function toFiniteNumber(value: unknown, field: string): number {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        throw new CustomError(`Campo ${field} inválido.`, 400, '');
    }
    return n;
}

function normalizeMoney(value: unknown, field: string): number {
    const n = toFiniteNumber(value, field);
    if (n < 0) {
        throw new CustomError(`Campo ${field} não pode ser negativo.`, 400, '');
    }
    return Math.round(n * 100) / 100;
}

function normalizeOptionalCupom(
    value: unknown
): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '' || value === 0 || value === '0') {
        return null;
    }
    const n = toFiniteNumber(value, 'idCupomPromocional');
    if (n <= 0) return null;
    return n;
}

function normalizeStatus(value: unknown, fallback?: EventoSuiteStatus): EventoSuiteStatus {
    if (value === undefined || value === null || value === '') {
        if (fallback) return fallback;
        throw new CustomError('Status é obrigatório.', 400, '');
    }
    const status = String(value);
    if (!EVENTO_SUITE_STATUS.includes(status as EventoSuiteStatus)) {
        throw new CustomError(
            `Status inválido. Use: ${EVENTO_SUITE_STATUS.join(', ')}.`,
            400,
            ''
        );
    }
    return status as EventoSuiteStatus;
}

async function resolverEscopoProdutor(idUsuario: number): Promise<EscopoProdutor> {
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
            'Usuário sem acesso a produtores para gerenciar suítes.',
            403,
            ''
        );
    }

    return { admGeral: false, idsProdutor };
}

async function carregarEventoAutorizado(
    idEvento: number,
    escopo: EscopoProdutor
): Promise<Evento> {
    const evento = await Evento.findByPk(idEvento, {
        attributes: ['id', 'nome', 'tipo', 'idProdutor', 'status'],
    });

    if (!evento) {
        throw new CustomError('Evento não encontrado.', 404, '');
    }

    if (String(evento.tipo) !== 'Pousada') {
        throw new CustomError(
            'Suítes só podem ser cadastradas em eventos do tipo Pousada.',
            400,
            ''
        );
    }

    if (
        !escopo.admGeral &&
        !escopo.idsProdutor.includes(Number(evento.idProdutor))
    ) {
        throw new CustomError(
            'Sem permissão para gerenciar suítes deste evento.',
            403,
            ''
        );
    }

    return evento;
}

async function assertSuiteAcesso(
    suite: EventoSuite,
    escopo: EscopoProdutor
): Promise<Evento> {
    const evento = await carregarEventoAutorizado(Number(suite.idEvento), escopo);
    return evento;
}

function validarCapacidade(min: number, max: number) {
    if (!Number.isInteger(min) || min < 1) {
        throw new CustomError(
            'Quantidade mínima de pessoas deve ser um inteiro ≥ 1.',
            400,
            ''
        );
    }
    if (!Number.isInteger(max) || max < 1) {
        throw new CustomError(
            'Quantidade máxima de pessoas deve ser um inteiro ≥ 1.',
            400,
            ''
        );
    }
    if (max < min) {
        throw new CustomError(
            'Quantidade máxima deve ser maior ou igual à mínima.',
            400,
            ''
        );
    }
}

async function validarCupom(
    idCupomPromocional: number | null | undefined,
    idProdutor: number
) {
    if (idCupomPromocional == null) return;

    const cupom = await CupomPromocional.findByPk(idCupomPromocional, {
        attributes: ['id', 'idProdutor'],
    });

    if (!cupom) {
        throw new CustomError('Cupom promocional não encontrado.', 404, '');
    }

    if (Number(cupom.idProdutor) !== Number(idProdutor)) {
        throw new CustomError(
            'Cupom promocional não pertence ao produtor do evento.',
            400,
            ''
        );
    }
}

function parseCreateInput(body: Record<string, unknown>): EventoSuiteCreateInput {
    const nome = String(body.nome ?? '').trim();
    if (!nome) {
        throw new CustomError('Nome é obrigatório.', 400, '');
    }

    const idEvento = toFiniteNumber(body.idEvento, 'idEvento');
    if (idEvento <= 0) {
        throw new CustomError('idEvento é obrigatório.', 400, '');
    }

    if (
        body.qtdeMinimaPessoas === undefined ||
        body.qtdeMinimaPessoas === null ||
        body.qtdeMinimaPessoas === ''
    ) {
        throw new CustomError('Quantidade mínima de pessoas é obrigatória.', 400, '');
    }
    if (
        body.qtdeMaximaPessoas === undefined ||
        body.qtdeMaximaPessoas === null ||
        body.qtdeMaximaPessoas === ''
    ) {
        throw new CustomError('Quantidade máxima de pessoas é obrigatória.', 400, '');
    }

    const qtdeMinimaPessoas = Math.trunc(
        toFiniteNumber(body.qtdeMinimaPessoas, 'qtdeMinimaPessoas')
    );
    const qtdeMaximaPessoas = Math.trunc(
        toFiniteNumber(body.qtdeMaximaPessoas, 'qtdeMaximaPessoas')
    );
    validarCapacidade(qtdeMinimaPessoas, qtdeMaximaPessoas);

    if (body.preco === undefined || body.preco === null || body.preco === '') {
        throw new CustomError('Preço é obrigatório.', 400, '');
    }
    if (
        body.taxaServico === undefined ||
        body.taxaServico === null ||
        body.taxaServico === ''
    ) {
        throw new CustomError('Taxa de serviço é obrigatória.', 400, '');
    }
    if (body.valor === undefined || body.valor === null || body.valor === '') {
        throw new CustomError('Valor é obrigatório.', 400, '');
    }

    const preco = normalizeMoney(body.preco, 'preco');
    const taxaServico = normalizeMoney(body.taxaServico, 'taxaServico');
    const valor = normalizeMoney(body.valor, 'valor');

    const descricaoRaw = body.descricao;
    const descricao =
        descricaoRaw === undefined || descricaoRaw === null
            ? null
            : String(descricaoRaw);

    return {
        nome,
        descricao,
        idEvento,
        qtdeMinimaPessoas,
        qtdeMaximaPessoas,
        preco,
        taxaServico,
        valor,
        status: normalizeStatus(body.status, 'Oculto'),
        idCupomPromocional: normalizeOptionalCupom(body.idCupomPromocional) ?? null,
    };
}

function parseUpdateInput(body: Record<string, unknown>): EventoSuiteUpdateInput {
    const out: EventoSuiteUpdateInput = {};

    if (body.nome !== undefined) {
        const nome = String(body.nome ?? '').trim();
        if (!nome) throw new CustomError('Nome é obrigatório.', 400, '');
        out.nome = nome;
    }

    if (body.descricao !== undefined) {
        out.descricao =
            body.descricao === null ? null : String(body.descricao);
    }

    if (body.idEvento !== undefined) {
        const idEvento = toFiniteNumber(body.idEvento, 'idEvento');
        if (idEvento <= 0) {
            throw new CustomError('idEvento inválido.', 400, '');
        }
        out.idEvento = idEvento;
    }

    if (body.qtdeMinimaPessoas !== undefined) {
        out.qtdeMinimaPessoas = Math.trunc(
            toFiniteNumber(body.qtdeMinimaPessoas, 'qtdeMinimaPessoas')
        );
    }

    if (body.qtdeMaximaPessoas !== undefined) {
        out.qtdeMaximaPessoas = Math.trunc(
            toFiniteNumber(body.qtdeMaximaPessoas, 'qtdeMaximaPessoas')
        );
    }

    if (body.preco !== undefined) {
        out.preco = normalizeMoney(body.preco, 'preco');
    }

    if (body.taxaServico !== undefined) {
        out.taxaServico = normalizeMoney(body.taxaServico, 'taxaServico');
    }

    if (body.valor !== undefined) {
        out.valor = normalizeMoney(body.valor, 'valor');
    }

    if (body.status !== undefined) {
        out.status = normalizeStatus(body.status);
    }

    if (body.idCupomPromocional !== undefined) {
        out.idCupomPromocional = normalizeOptionalCupom(body.idCupomPromocional) ?? null;
    }

    return out;
}

const suiteIncludeBase = [
    {
        model: CupomPromocional,
        as: 'CupomPromocional',
        attributes: ['id', 'nome'],
        required: false,
    },
    {
        model: Evento,
        as: 'Evento',
        attributes: ['id', 'nome', 'tipo', 'idProdutor'],
        required: false,
    },
];

const suiteIncludeWithFotos = [
    ...suiteIncludeBase,
    {
        model: EventoSuiteFoto,
        as: 'Fotos',
        required: false,
        separate: true,
        order: [
            ['ordem', 'ASC'],
            ['id', 'ASC'],
        ],
    },
];

function serializeSuite(suite: EventoSuite) {
    const json = suite.toJSON() as unknown as Record<string, unknown>;
    const cupom = (suite as any).CupomPromocional;
    if (cupom?.nome != null) {
        json.CupomPromocional_nome = cupom.nome;
    }
    const fotos = (suite as any).Fotos;
    json.Fotos = Array.isArray(fotos)
        ? fotos.map((f: any) => ({
              id: f.id,
              idEventoSuite: f.idEventoSuite,
              arquivo: f.arquivo,
              ordem: f.ordem,
              principal: Boolean(f.principal),
              createdAt: f.createdAt,
              updatedAt: f.updatedAt,
          }))
        : [];
    return json;
}

async function contarDependencias(idEventoSuite: number) {
    const [reservas, movimentacoesOrigem, movimentacoesDestino, transacoes, mappings] =
        await Promise.all([
            ReservaSuite.count({ where: { idEventoSuite } }),
            ReservaSuiteMovimentacao.count({
                where: { idEventoSuiteOrigem: idEventoSuite },
            }),
            ReservaSuiteMovimentacao.count({
                where: { idEventoSuiteDestino: idEventoSuite },
            }),
            EventoSuiteTransacao.count({ where: { idEventoSuite } }),
            HospedinPlaceSuiteMap.count({
                where: { id_evento_suite: idEventoSuite },
            }),
        ]);

    return {
        reservas,
        movimentacoes: movimentacoesOrigem + movimentacoesDestino,
        transacoes,
        mappings,
        bloqueado:
            reservas > 0 ||
            movimentacoesOrigem + movimentacoesDestino > 0 ||
            transacoes > 0 ||
            mappings > 0,
    };
}

export const EventoSuiteService = {
    /**
     * Autorização leve (sem carregar fotos/cupom).
     * Usado por EventoSuiteFotoService e mutações auxiliares.
     */
    async assertCanManage(idUsuario: number, idEventoSuite: number) {
        const escopo = await resolverEscopoProdutor(idUsuario);
        const suite = await EventoSuite.findByPk(idEventoSuite, {
            attributes: ['id', 'idEvento'],
        });
        if (!suite) {
            throw new CustomError('Suíte não encontrada.', 404, '');
        }
        await assertSuiteAcesso(suite, escopo);
        return suite;
    },

    async create(idUsuario: number, body: Record<string, unknown>) {
        const escopo = await resolverEscopoProdutor(idUsuario);
        const input = parseCreateInput(body);
        const evento = await carregarEventoAutorizado(input.idEvento, escopo);
        await validarCupom(input.idCupomPromocional, Number(evento.idProdutor));

        const created = await EventoSuite.create({
            nome: input.nome,
            descricao: input.descricao ?? undefined,
            idEvento: input.idEvento,
            qtdeMinimaPessoas: input.qtdeMinimaPessoas,
            qtdeMaximaPessoas: input.qtdeMaximaPessoas,
            preco: input.preco,
            taxaServico: input.taxaServico,
            valor: input.valor,
            status: input.status as any,
            idCupomPromocional: input.idCupomPromocional ?? undefined,
        });

        return this.getById(idUsuario, created.id);
    },

    async update(
        idUsuario: number,
        id: number,
        body: Record<string, unknown>
    ) {
        const escopo = await resolverEscopoProdutor(idUsuario);
        const suite = await EventoSuite.findByPk(id);
        if (!suite) {
            throw new CustomError('Suíte não encontrada.', 404, '');
        }

        await assertSuiteAcesso(suite, escopo);
        const patch = parseUpdateInput(body);

        const nextIdEvento = patch.idEvento ?? Number(suite.idEvento);
        if (
            patch.idEvento !== undefined &&
            Number(patch.idEvento) !== Number(suite.idEvento)
        ) {
            const deps = await contarDependencias(id);
            if (deps.bloqueado) {
                throw new CustomError(
                    'Não é possível alterar o evento desta suíte porque ela já possui histórico (reservas, movimentações, transações ou vínculo Hospedin).',
                    409,
                    'SUITE_EVENTO_LOCKED',
                    {
                        reservas: deps.reservas,
                        movimentacoes: deps.movimentacoes,
                        transacoes: deps.transacoes,
                        mappings: deps.mappings,
                    }
                );
            }
        }

        const evento = await carregarEventoAutorizado(nextIdEvento, escopo);

        const nextMin =
            patch.qtdeMinimaPessoas ?? Number(suite.qtdeMinimaPessoas);
        const nextMax =
            patch.qtdeMaximaPessoas ?? Number(suite.qtdeMaximaPessoas);
        validarCapacidade(nextMin, nextMax);

        const nextCupom =
            patch.idCupomPromocional !== undefined
                ? patch.idCupomPromocional
                : suite.idCupomPromocional ?? null;
        await validarCupom(nextCupom, Number(evento.idProdutor));

        if (patch.nome !== undefined) suite.nome = patch.nome;
        if (patch.descricao !== undefined) {
            suite.descricao = patch.descricao ?? undefined;
        }
        if (patch.idEvento !== undefined) suite.idEvento = patch.idEvento;
        if (patch.qtdeMinimaPessoas !== undefined) {
            suite.qtdeMinimaPessoas = patch.qtdeMinimaPessoas;
        }
        if (patch.qtdeMaximaPessoas !== undefined) {
            suite.qtdeMaximaPessoas = patch.qtdeMaximaPessoas;
        }
        if (patch.preco !== undefined) suite.preco = patch.preco;
        if (patch.taxaServico !== undefined) {
            suite.taxaServico = patch.taxaServico;
        }
        if (patch.valor !== undefined) suite.valor = patch.valor;
        if (patch.status !== undefined) suite.status = patch.status as any;
        if (patch.idCupomPromocional !== undefined) {
            suite.idCupomPromocional = patch.idCupomPromocional ?? undefined;
        }

        await suite.save();
        return this.getById(idUsuario, suite.id);
    },

    async delete(idUsuario: number, id: number) {
        const escopo = await resolverEscopoProdutor(idUsuario);
        const suite = await EventoSuite.findByPk(id);
        if (!suite) {
            throw new CustomError('Suíte não encontrada.', 404, '');
        }

        await assertSuiteAcesso(suite, escopo);

        const deps = await contarDependencias(id);
        if (deps.bloqueado) {
            throw new CustomError(MSG_DELETE_BLOQUEADO, 409, 'SUITE_HAS_DEPENDENCIES', {
                reservas: deps.reservas,
                movimentacoes: deps.movimentacoes,
                transacoes: deps.transacoes,
                mappings: deps.mappings,
            });
        }

        // Evita dependência circular estática; FotosService cuida de fotos/arquivos.
        const connection = require('../database').default;
        const { EventoSuiteFotoService } = require('./EventoSuiteFotoService');
        const arquivos = await EventoSuiteFotoService.listArquivos(id);

        await connection.transaction(async (t: any) => {
            await EventoSuiteFotoService.destroyAllInTransaction(id, t);
            await suite.destroy({ transaction: t });
        });

        await EventoSuiteFotoService.deletePhysicalFiles(arquivos);

        return {
            message: 'Suíte excluída com sucesso.',
            id,
        };
    },

    async getById(idUsuario: number, id: number) {
        const escopo = await resolverEscopoProdutor(idUsuario);
        const suite = await EventoSuite.findByPk(id, {
            include: suiteIncludeWithFotos as any,
        });

        if (!suite) {
            throw new CustomError('Suíte não encontrada.', 404, '');
        }

        await assertSuiteAcesso(suite, escopo);
        return serializeSuite(suite);
    },

    async listByEvento(idUsuario: number, params: EventoSuiteListParams) {
        const escopo = await resolverEscopoProdutor(idUsuario);
        const page = Math.max(1, Number(params.page) || 1);
        const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 50));
        const search = String(params.search || '').trim();

        const where: Record<string, unknown> = {};

        if (params.idEvento != null && Number(params.idEvento) > 0) {
            const idEvento = Number(params.idEvento);
            await carregarEventoAutorizado(idEvento, escopo);
            where.idEvento = idEvento;
        } else if (!escopo.admGeral) {
            const eventos = await Evento.findAll({
                where: {
                    tipo: 'Pousada',
                    idProdutor: { [Op.in]: escopo.idsProdutor },
                },
                attributes: ['id'],
            });
            const ids = eventos.map((e) => e.id);
            where.idEvento = ids.length > 0 ? { [Op.in]: ids } : { [Op.in]: [-1] };
        } else {
            // admGeral sem filtro: apenas suítes de eventos Pousada
            const eventos = await Evento.findAll({
                where: { tipo: 'Pousada' },
                attributes: ['id'],
            });
            where.idEvento = {
                [Op.in]: eventos.map((e) => e.id),
            };
        }

        if (search) {
            Object.assign(where, {
                [Op.or]: [
                    { nome: { [Op.like]: `%${search}%` } },
                    { descricao: { [Op.like]: `%${search}%` } },
                ],
            });
        }

        const { rows, count } = await EventoSuite.findAndCountAll({
            where,
            include: suiteIncludeBase as any,
            order: [['nome', 'ASC']],
            limit: pageSize,
            offset: (page - 1) * pageSize,
        });

        return {
            data: rows.map(serializeSuite),
            meta: {
                totalItems: count,
                totalPages: Math.ceil(count / pageSize) || 0,
                currentPage: page,
                pageSize,
            },
        };
    },
};

export default EventoSuiteService;
