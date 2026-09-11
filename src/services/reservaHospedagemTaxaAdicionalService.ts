import { Transaction } from 'sequelize';
import connection from '../database';
import { Evento } from '../models/Evento';
import { ProdutorAcesso, TipoAcesso } from '../models/Produtor';
import { ReservaHospedagem } from '../models/ReservaHospedagem';
import { ReservaHospedagemTaxaAdicional } from '../models/ReservaHospedagemTaxaAdicional';
import { ReservaSuite } from '../models/ReservaSuite';
import { CustomError } from '../utils/customError';
import {
    recalcularFinanceiroReservaComServicos,
    statusPermiteServicosAdicionais,
    validarInputTaxaAdicional,
} from './reservaSuiteFinanceiroService';

export type PermissoesTaxasAdicionaisReserva = {
    podeVisualizar: boolean;
    podeAdicionar: boolean;
    podeEditar: boolean;
    podeExcluir: boolean;
};

function tipoAcessoPermiteTaxas(
    tipoAcesso: TipoAcesso | null | undefined
): TipoAcesso.Administrador | TipoAcesso.PDV | null {
    if (tipoAcesso === TipoAcesso.Administrador) {
        return TipoAcesso.Administrador;
    }
    if (tipoAcesso === TipoAcesso.PDV) {
        return TipoAcesso.PDV;
    }
    return null;
}

export function resolverPermissoesTaxasAdicionaisReserva(
    tipoAcesso: TipoAcesso | null | undefined
): PermissoesTaxasAdicionaisReserva {
    const tipo = tipoAcessoPermiteTaxas(tipoAcesso);
    if (tipo === TipoAcesso.Administrador) {
        return {
            podeVisualizar: true,
            podeAdicionar: true,
            podeEditar: true,
            podeExcluir: true,
        };
    }
    if (tipo === TipoAcesso.PDV) {
        return {
            podeVisualizar: true,
            podeAdicionar: true,
            podeEditar: false,
            podeExcluir: false,
        };
    }
    return {
        podeVisualizar: false,
        podeAdicionar: false,
        podeEditar: false,
        podeExcluir: false,
    };
}

async function obterTipoAcessoTaxasParaProdutor(
    idUsuario: number,
    idProdutor: number
): Promise<TipoAcesso.Administrador | TipoAcesso.PDV | null> {
    const acesso = await ProdutorAcesso.findOne({
        where: { idUsuario, idProdutor },
        attributes: ['tipoAcesso'],
    });
    return tipoAcessoPermiteTaxas(acesso?.tipoAcesso ?? null);
}

async function carregarContextoTaxa(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    exigePermissao: 'visualizar' | 'adicionar' | 'editar' | 'excluir';
}) {
    const reserva = (await ReservaHospedagem.findByPk(params.idReservaHospedagem, {
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
          })
        | null;

    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    const idProdutor = Number(reserva.Evento?.idProdutor);
    if (!Number.isFinite(idProdutor) || idProdutor <= 0) {
        throw new CustomError('Sem permissão para esta reserva.', 403, '');
    }

    const tipoAcesso = await obterTipoAcessoTaxasParaProdutor(
        params.idUsuario,
        idProdutor
    );
    const permissoes = resolverPermissoesTaxasAdicionaisReserva(tipoAcesso);

    const mapaPermissao: Record<
        typeof params.exigePermissao,
        keyof PermissoesTaxasAdicionaisReserva
    > = {
        visualizar: 'podeVisualizar',
        adicionar: 'podeAdicionar',
        editar: 'podeEditar',
        excluir: 'podeExcluir',
    };

    if (!permissoes[mapaPermissao[params.exigePermissao]]) {
        throw new CustomError('Sem permissão para esta operação.', 403, '');
    }

    if (!statusPermiteServicosAdicionais(reserva.status)) {
        throw new CustomError(
            'Não é possível alterar taxas neste status da reserva.',
            400,
            ''
        );
    }

    return { permissoes, reserva };
}

export async function validarIdReservaSuiteParaTaxa(params: {
    idReservaHospedagem: number;
    idReservaSuite?: unknown;
    obrigatorio?: boolean;
}): Promise<number | null> {
    const bruto = params.idReservaSuite;
    const informado =
        bruto !== undefined && bruto !== null && String(bruto).trim() !== '';

    if (!informado) {
        if (params.obrigatorio) {
            throw new CustomError('idReservaSuite é obrigatório.', 400, '');
        }
        return null;
    }

    const idReservaSuite = Number(bruto);
    if (!Number.isFinite(idReservaSuite) || idReservaSuite <= 0) {
        throw new CustomError('idReservaSuite inválido.', 400, '');
    }

    const suite = await ReservaSuite.findOne({
        where: { id: idReservaSuite },
        attributes: ['id', 'idReservaHospedagem'],
    });

    if (!suite) {
        throw new CustomError('Suíte da reserva não encontrada.', 404, '');
    }

    if (Number(suite.idReservaHospedagem) !== Number(params.idReservaHospedagem)) {
        throw new CustomError(
            'A suíte informada não pertence a esta reserva.',
            400,
            ''
        );
    }

    return idReservaSuite;
}

export function resolverIdReservaSuitePorEventoSuite(
    suitesCriadas: Array<{ id: number; idEventoSuite: number }>,
    idEventoSuite: number
): number {
    const idEvento = Number(idEventoSuite);
    if (!Number.isFinite(idEvento) || idEvento <= 0) {
        throw new CustomError(
            'idEventoSuite da taxa adicional é obrigatório.',
            400,
            ''
        );
    }

    const suite = suitesCriadas.find(
        (item) => Number(item.idEventoSuite) === idEvento
    );
    if (!suite) {
        throw new CustomError(
            'idEventoSuite da taxa não pertence às suítes da reserva.',
            400,
            ''
        );
    }

    return suite.id;
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

async function notificarAlteracaoFinanceira(idReservaHospedagem: number) {
    const { incrementarHospedagemRefreshVersion } = await import(
        './hospedagemRefreshVersionService'
    );
    await incrementarHospedagemRefreshVersion();

    const { hospedinOutboundEnqueueService } = await import(
        '../integrations/hospedin/outbound/HospedinOutboundEnqueueService'
    );
    await hospedinOutboundEnqueueService.markDirty(idReservaHospedagem);
}

export async function adicionarTaxaAdicionalReserva(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    descricao: string;
    valor: number;
    idReservaSuite?: unknown;
}) {
    const { descricao, valor } = validarInputTaxaAdicional(params);
    const idReservaSuite = await validarIdReservaSuiteParaTaxa({
        idReservaHospedagem: params.idReservaHospedagem,
        idReservaSuite: params.idReservaSuite,
        obrigatorio: true,
    });
    await carregarContextoTaxa({
        idReservaHospedagem: params.idReservaHospedagem,
        idUsuario: params.idUsuario,
        exigePermissao: 'adicionar',
    });

    await connection.transaction(async (transaction: Transaction) => {
        const ordem = await proximaOrdemTaxa(
            params.idReservaHospedagem,
            transaction
        );
        await ReservaHospedagemTaxaAdicional.create(
            {
                idReservaHospedagem: params.idReservaHospedagem,
                idReservaSuite,
                descricao,
                valor,
                ordem,
                idUsuarioCriacao: params.idUsuario,
            },
            { transaction }
        );

        await recalcularFinanceiroReservaComServicos(
            params.idReservaHospedagem,
            transaction,
            {
                idUsuarioHistorico: params.idUsuario,
                descricaoHistorico: `Taxa adicional incluída: ${descricao} (${valor.toFixed(2)})`,
            }
        );
    });

    await notificarAlteracaoFinanceira(params.idReservaHospedagem);

    const { obterReservaAdminDetalhe } = await import('./hospedagemAdminService');
    return obterReservaAdminDetalhe(
        params.idReservaHospedagem,
        params.idUsuario
    );
}

export async function editarTaxaAdicionalReserva(params: {
    idReservaHospedagem: number;
    idTaxa: number;
    idUsuario: number;
    descricao: string;
    valor: number;
    idReservaSuite?: unknown;
}) {
    const { descricao, valor } = validarInputTaxaAdicional(params);
    await carregarContextoTaxa({
        idReservaHospedagem: params.idReservaHospedagem,
        idUsuario: params.idUsuario,
        exigePermissao: 'editar',
    });

    const taxa = await ReservaHospedagemTaxaAdicional.findOne({
        where: {
            id: params.idTaxa,
            idReservaHospedagem: params.idReservaHospedagem,
        },
    });
    if (!taxa) {
        throw new CustomError('Taxa adicional não encontrada.', 404, '');
    }

    let idReservaSuite: number | null | undefined;
    if (params.idReservaSuite !== undefined) {
        idReservaSuite = await validarIdReservaSuiteParaTaxa({
            idReservaHospedagem: params.idReservaHospedagem,
            idReservaSuite: params.idReservaSuite,
            obrigatorio: false,
        });
    }

    await connection.transaction(async (transaction: Transaction) => {
        await taxa.update(
            {
                descricao,
                valor,
                ...(idReservaSuite !== undefined ? { idReservaSuite } : {}),
            },
            { transaction }
        );

        await recalcularFinanceiroReservaComServicos(
            params.idReservaHospedagem,
            transaction,
            {
                idUsuarioHistorico: params.idUsuario,
                descricaoHistorico: `Taxa adicional alterada: ${descricao} (${valor.toFixed(2)})`,
            }
        );
    });

    await notificarAlteracaoFinanceira(params.idReservaHospedagem);

    const { obterReservaAdminDetalhe } = await import('./hospedagemAdminService');
    return obterReservaAdminDetalhe(
        params.idReservaHospedagem,
        params.idUsuario
    );
}

export async function excluirTaxaAdicionalReserva(params: {
    idReservaHospedagem: number;
    idTaxa: number;
    idUsuario: number;
}) {
    await carregarContextoTaxa({
        idReservaHospedagem: params.idReservaHospedagem,
        idUsuario: params.idUsuario,
        exigePermissao: 'excluir',
    });

    const taxa = await ReservaHospedagemTaxaAdicional.findOne({
        where: {
            id: params.idTaxa,
            idReservaHospedagem: params.idReservaHospedagem,
        },
    });
    if (!taxa) {
        throw new CustomError('Taxa adicional não encontrada.', 404, '');
    }

    const descricaoRemovida = taxa.descricao;

    await connection.transaction(async (transaction: Transaction) => {
        await taxa.destroy({ transaction });

        await recalcularFinanceiroReservaComServicos(
            params.idReservaHospedagem,
            transaction,
            {
                idUsuarioHistorico: params.idUsuario,
                descricaoHistorico: `Taxa adicional removida: ${descricaoRemovida}`,
            }
        );
    });

    await notificarAlteracaoFinanceira(params.idReservaHospedagem);

    const { obterReservaAdminDetalhe } = await import('./hospedagemAdminService');
    return obterReservaAdminDetalhe(
        params.idReservaHospedagem,
        params.idUsuario
    );
}

export async function obterPermissoesTaxasUsuario(
    idUsuario: number,
    idProdutor?: number
): Promise<PermissoesTaxasAdicionaisReserva> {
    if (idProdutor && Number.isFinite(idProdutor) && idProdutor > 0) {
        const tipoAcesso = await obterTipoAcessoTaxasParaProdutor(
            idUsuario,
            idProdutor
        );
        return resolverPermissoesTaxasAdicionaisReserva(tipoAcesso);
    }

    const acessos = await ProdutorAcesso.findAll({
        where: { idUsuario },
        attributes: ['tipoAcesso'],
    });

    const tipos = acessos.map((acesso) => acesso.tipoAcesso);
    let tipoAcesso: TipoAcesso | null = null;
    if (tipos.includes(TipoAcesso.Administrador)) {
        tipoAcesso = TipoAcesso.Administrador;
    } else if (tipos.includes(TipoAcesso.PDV)) {
        tipoAcesso = TipoAcesso.PDV;
    }

    return resolverPermissoesTaxasAdicionaisReserva(tipoAcesso);
}
