import { Op } from 'sequelize';
import { Evento } from '../models/Evento';
import { HospedagemFechamentoExcepcional } from '../models/HospedagemFechamentoExcepcional';
import { Usuario } from '../models/Usuario';
import { ProdutorAcesso } from '../models/Produtor';
import { CustomError } from '../utils/customError';
import {
    criarVerificadorFechamentosExcepcionais,
    dataCivilHospedagem,
    type IntervaloDataCivilFechamento,
    validarPeriodoPousadaFechado,
    type VerificadorDataCivilFechada,
} from '../utils/reservaSuiteUtils';

const RE_DATA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

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

export async function assertAcessoEventoPousada(
    idUsuario: number,
    idEvento: number
): Promise<Evento> {
    const escopo = await resolverEscopoProdutor(idUsuario);
    const evento = await Evento.findByPk(idEvento, {
        attributes: ['id', 'nome', 'idProdutor', 'tipo'],
    });

    if (!evento || (evento as Evento & { tipo?: string }).tipo !== 'Pousada') {
        throw new CustomError('Evento de pousada não encontrado.', 404, '');
    }

    if (
        !escopo.admGeral &&
        !escopo.idsProdutor.includes(Number(evento.idProdutor))
    ) {
        throw new CustomError('Sem permissão para este evento.', 403, '');
    }

    return evento;
}

function parseDataCivilParam(
    value: unknown,
    fieldName: string
): string {
    if (typeof value !== 'string' || !RE_DATA_CIVIL.test(value.trim())) {
        throw new CustomError(
            `${fieldName} deve estar no formato yyyy-MM-dd.`,
            400,
            ''
        );
    }
    return value.trim();
}

export type FechamentoExcepcionalDto = {
    id: number;
    idEvento: number;
    dataInicio: string;
    dataFim: string;
    motivo: string | null;
    ativo: boolean;
    idUsuarioCriacao: number | null;
    idUsuarioAtualizacao: number | null;
    createdAt: string;
    updatedAt: string;
};

function toDto(row: HospedagemFechamentoExcepcional): FechamentoExcepcionalDto {
    return {
        id: row.id,
        idEvento: row.idEvento,
        dataInicio: String(row.dataInicio),
        dataFim: String(row.dataFim),
        motivo: row.motivo,
        ativo: Boolean(row.ativo),
        idUsuarioCriacao: row.idUsuarioCriacao,
        idUsuarioAtualizacao: row.idUsuarioAtualizacao,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

export async function listarFechamentosExcepcionaisAdmin(params: {
    idUsuario: number;
    idEvento: number;
    incluirInativos?: boolean;
}): Promise<FechamentoExcepcionalDto[]> {
    await assertAcessoEventoPousada(params.idUsuario, params.idEvento);

    const where: Record<string, unknown> = { idEvento: params.idEvento };
    if (!params.incluirInativos) {
        where.ativo = true;
    }

    const rows = await HospedagemFechamentoExcepcional.findAll({
        where,
        order: [
            ['dataInicio', 'DESC'],
            ['id', 'DESC'],
        ],
    });

    return rows.map(toDto);
}

export async function listarIntervalosAtivosPorPeriodo(params: {
    idEvento: number;
    dataInicioCivil: string;
    dataFimCivil: string;
}): Promise<IntervaloDataCivilFechamento[]> {
    const rows = await HospedagemFechamentoExcepcional.findAll({
        where: {
            idEvento: params.idEvento,
            ativo: true,
            dataFim: { [Op.gte]: params.dataInicioCivil },
            dataInicio: { [Op.lte]: params.dataFimCivil },
        },
        attributes: ['dataInicio', 'dataFim'],
        order: [['dataInicio', 'ASC']],
    });

    return rows.map((r) => ({
        inicio: String(r.dataInicio),
        fim: String(r.dataFim),
    }));
}

export async function listarIntervalosAtivosPorEventosNoPeriodo(params: {
    idsEvento: number[];
    dataInicioCivil: string;
    dataFimCivil: string;
}): Promise<Map<number, IntervaloDataCivilFechamento[]>> {
    const map = new Map<number, IntervaloDataCivilFechamento[]>();
    const ids = [...new Set(params.idsEvento.filter((id) => id > 0))];
    if (!ids.length) {
        return map;
    }

    const rows = await HospedagemFechamentoExcepcional.findAll({
        where: {
            idEvento: { [Op.in]: ids },
            ativo: true,
            dataFim: { [Op.gte]: params.dataInicioCivil },
            dataInicio: { [Op.lte]: params.dataFimCivil },
        },
        attributes: ['idEvento', 'dataInicio', 'dataFim'],
        order: [['dataInicio', 'ASC']],
    });

    for (const row of rows) {
        const lista = map.get(row.idEvento) ?? [];
        lista.push({
            inicio: String(row.dataInicio),
            fim: String(row.dataFim),
        });
        map.set(row.idEvento, lista);
    }

    return map;
}

export async function criarVerificadorFechamentosExcepcionaisEvento(
    idEvento: number,
    checkin: Date,
    checkout: Date
): Promise<VerificadorDataCivilFechada> {
    const ci = dataCivilHospedagem(checkin);
    const co = dataCivilHospedagem(checkout);
    const intervalos = await listarIntervalosAtivosPorPeriodo({
        idEvento,
        dataInicioCivil: ci,
        dataFimCivil: co,
    });
    return criarVerificadorFechamentosExcepcionais(intervalos);
}

export async function validarPeriodoReservaPousada(
    idEvento: number,
    checkin: Date,
    checkout: Date
): Promise<void> {
    const verificador = await criarVerificadorFechamentosExcepcionaisEvento(
        idEvento,
        checkin,
        checkout
    );
    validarPeriodoPousadaFechado(checkin, checkout, verificador);
}

export async function listarFechamentosPublicosPorPeriodo(params: {
    idEvento: number;
    de: string;
    ate: string;
}): Promise<
    Array<{ dataInicio: string; dataFim: string; motivo: string | null }>
> {
    const evento = await Evento.findByPk(params.idEvento, {
        attributes: ['id', 'tipo'],
    });
    if (!evento || (evento as Evento & { tipo?: string }).tipo !== 'Pousada') {
        throw new CustomError('Evento de pousada não encontrado.', 404, '');
    }

    const de = parseDataCivilParam(params.de, 'de');
    const ate = parseDataCivilParam(params.ate, 'ate');
    if (ate < de) {
        throw new CustomError('ate deve ser igual ou posterior a de.', 400, '');
    }

    const rows = await HospedagemFechamentoExcepcional.findAll({
        where: {
            idEvento: params.idEvento,
            ativo: true,
            dataFim: { [Op.gte]: de },
            dataInicio: { [Op.lte]: ate },
        },
        attributes: ['dataInicio', 'dataFim', 'motivo'],
        order: [['dataInicio', 'ASC']],
    });

    return rows.map((r) => ({
        dataInicio: String(r.dataInicio),
        dataFim: String(r.dataFim),
        motivo: r.motivo,
    }));
}

export async function listarEventosPousadaAdmin(idUsuario: number) {
    const escopo = await resolverEscopoProdutor(idUsuario);
    const where: Record<string, unknown> = { tipo: 'Pousada' };
    if (!escopo.admGeral) {
        where.idProdutor = { [Op.in]: escopo.idsProdutor };
    }

    const eventos = await Evento.findAll({
        where,
        attributes: ['id', 'nome', 'idProdutor'],
        order: [['nome', 'ASC']],
    });

    return eventos.map((e) => ({
        id: e.id,
        nome: e.nome,
        idProdutor: e.idProdutor,
    }));
}

function validarIntervaloCadastro(dataInicio: string, dataFim: string) {
    if (dataFim < dataInicio) {
        throw new CustomError(
            'A data final deve ser igual ou posterior à data inicial.',
            400,
            ''
        );
    }
}

export async function criarFechamentoExcepcionalAdmin(params: {
    idUsuario: number;
    idEvento: number;
    dataInicio: string;
    dataFim: string;
    motivo?: string | null;
}) {
    await assertAcessoEventoPousada(params.idUsuario, params.idEvento);

    const dataInicio = parseDataCivilParam(params.dataInicio, 'dataInicio');
    const dataFim = parseDataCivilParam(params.dataFim, 'dataFim');
    validarIntervaloCadastro(dataInicio, dataFim);

    const motivo = params.motivo?.trim() || null;

    const row = await HospedagemFechamentoExcepcional.create({
        idEvento: params.idEvento,
        dataInicio,
        dataFim,
        motivo,
        ativo: true,
        idUsuarioCriacao: params.idUsuario,
        idUsuarioAtualizacao: params.idUsuario,
    });

    return toDto(row);
}

export async function atualizarFechamentoExcepcionalAdmin(params: {
    idUsuario: number;
    id: number;
    dataInicio?: string;
    dataFim?: string;
    motivo?: string | null;
    ativo?: boolean;
}) {
    const row = await HospedagemFechamentoExcepcional.findByPk(params.id);
    if (!row) {
        throw new CustomError('Fechamento não encontrado.', 404, '');
    }

    await assertAcessoEventoPousada(params.idUsuario, row.idEvento);

    const patch: Partial<HospedagemFechamentoExcepcional> = {
        idUsuarioAtualizacao: params.idUsuario,
    };

    if (params.dataInicio !== undefined) {
        patch.dataInicio = parseDataCivilParam(params.dataInicio, 'dataInicio');
    }
    if (params.dataFim !== undefined) {
        patch.dataFim = parseDataCivilParam(params.dataFim, 'dataFim');
    }
    if (params.motivo !== undefined) {
        patch.motivo = params.motivo?.trim() || null;
    }
    if (params.ativo !== undefined) {
        patch.ativo = Boolean(params.ativo);
    }

    const dataInicio = String(patch.dataInicio ?? row.dataInicio);
    const dataFim = String(patch.dataFim ?? row.dataFim);
    validarIntervaloCadastro(dataInicio, dataFim);

    await row.update(patch);
    return toDto(row);
}

export function isDataCivilFechadaExcepcional(
    dataCivil: string,
    verificador: VerificadorDataCivilFechada
): boolean {
    return verificador(dataCivil);
}
