import { Transaction } from 'sequelize';
import connection from '../database';
import { Evento } from '../models/Evento';
import { ProdutorAcesso, TipoAcesso } from '../models/Produtor';
import { ReservaHospedagem } from '../models/ReservaHospedagem';
import { ReservaSuite } from '../models/ReservaSuite';
import { ReservaSuiteItemServico } from '../models/ReservaSuiteItemServico';
import { Usuario } from '../models/Usuario';
import { CustomError } from '../utils/customError';
import { roundMoney, toNumber } from '../utils/reservaSuitePricing';
import {
    recalcularFinanceiroReservaComServicos,
    statusPermiteServicosAdicionais,
    validarInputServico,
} from './reservaSuiteFinanceiroService';

export type PermissoesServicosSuite = {
    podeVisualizar: boolean;
    podeAdicionar: boolean;
    podeEditar: boolean;
    podeExcluir: boolean;
};

export type ServicoSuiteDto = {
    id: number;
    idReservaSuite: number;
    descricao: string;
    valor: number;
    ordem: number;
};

function mapServicoDto(item: ReservaSuiteItemServico): ServicoSuiteDto {
    return {
        id: item.id,
        idReservaSuite: item.idReservaSuite,
        descricao: item.descricao,
        valor: roundMoney(toNumber(item.valor)),
        ordem: Number(item.ordem || 1),
    };
}

async function resolverEscopoProdutor(idUsuario: number): Promise<{
    admGeral: boolean;
    idsProdutor: number[];
    tipoAcesso: TipoAcesso | 'ADM_GERAL' | null;
}> {
    const usuario = await Usuario.findByPk(idUsuario, {
        attributes: ['id', 'admGeral'],
    });
    if (!usuario) {
        throw new CustomError('Usuário não autenticado.', 401, '');
    }
    if (usuario.admGeral) {
        return { admGeral: true, idsProdutor: [], tipoAcesso: 'ADM_GERAL' };
    }

    const acessos = await ProdutorAcesso.findAll({
        where: { idUsuario },
        attributes: ['idProdutor', 'tipoAcesso'],
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

    const tipos = new Set(acessos.map((a) => a.tipoAcesso));
    let tipoAcesso: TipoAcesso | null = null;
    if (tipos.has(TipoAcesso.Administrador)) {
        tipoAcesso = TipoAcesso.Administrador;
    } else if (tipos.has(TipoAcesso.PDV)) {
        tipoAcesso = TipoAcesso.PDV;
    } else if (tipos.has(TipoAcesso.Validador)) {
        tipoAcesso = TipoAcesso.Validador;
    }

    return { admGeral: false, idsProdutor, tipoAcesso };
}

export function resolverPermissoesServicosSuite(
    escopo: Awaited<ReturnType<typeof resolverEscopoProdutor>>
): PermissoesServicosSuite {
    if (escopo.admGeral || escopo.tipoAcesso === TipoAcesso.Administrador) {
        return {
            podeVisualizar: true,
            podeAdicionar: true,
            podeEditar: true,
            podeExcluir: true,
        };
    }
    if (escopo.tipoAcesso === TipoAcesso.PDV) {
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

async function carregarContextoServico(params: {
    idReservaHospedagem: number;
    idReservaSuite: number;
    idUsuario: number;
    exigePermissao: 'visualizar' | 'adicionar' | 'editar' | 'excluir';
}) {
    const escopo = await resolverEscopoProdutor(params.idUsuario);
    const permissoes = resolverPermissoesServicosSuite(escopo);

    const mapaPermissao: Record<
        typeof params.exigePermissao,
        keyof PermissoesServicosSuite
    > = {
        visualizar: 'podeVisualizar',
        adicionar: 'podeAdicionar',
        editar: 'podeEditar',
        excluir: 'podeExcluir',
    };

    if (!permissoes[mapaPermissao[params.exigePermissao]]) {
        throw new CustomError('Sem permissão para esta operação.', 403, '');
    }

    const reserva = (await ReservaHospedagem.findByPk(params.idReservaHospedagem, {
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
        throw new CustomError('Sem permissão para esta reserva.', 403, '');
    }

    if (!statusPermiteServicosAdicionais(reserva.status)) {
        throw new CustomError(
            'Não é possível alterar serviços neste status da reserva.',
            400,
            ''
        );
    }

    const linha = (reserva.ReservaSuite ?? []).find(
        (s) => s.id === params.idReservaSuite
    );
    if (!linha) {
        throw new CustomError('Linha de suíte da reserva não encontrada.', 404, '');
    }

    return { escopo, permissoes, reserva, linha };
}

async function proximaOrdemServico(
    idReservaSuite: number,
    transaction: Transaction
): Promise<number> {
    const maxOrdem = await ReservaSuiteItemServico.max('ordem', {
        where: { idReservaSuite },
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

export async function adicionarServicoSuiteReserva(params: {
    idReservaHospedagem: number;
    idReservaSuite: number;
    idUsuario: number;
    descricao: string;
    valor: number;
}) {
    const { descricao, valor } = validarInputServico(params);
    await carregarContextoServico({
        idReservaHospedagem: params.idReservaHospedagem,
        idReservaSuite: params.idReservaSuite,
        idUsuario: params.idUsuario,
        exigePermissao: 'adicionar',
    });

    await connection.transaction(async (transaction: Transaction) => {
        const ordem = await proximaOrdemServico(params.idReservaSuite, transaction);
        await ReservaSuiteItemServico.create(
            {
                idReservaSuite: params.idReservaSuite,
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
                descricaoHistorico: `Serviço adicional incluído: ${descricao} (${valor.toFixed(2)})`,
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

export async function editarServicoSuiteReserva(params: {
    idReservaHospedagem: number;
    idReservaSuite: number;
    idServico: number;
    idUsuario: number;
    descricao: string;
    valor: number;
}) {
    const { descricao, valor } = validarInputServico(params);
    await carregarContextoServico({
        idReservaHospedagem: params.idReservaHospedagem,
        idReservaSuite: params.idReservaSuite,
        idUsuario: params.idUsuario,
        exigePermissao: 'editar',
    });

    const servico = await ReservaSuiteItemServico.findOne({
        where: {
            id: params.idServico,
            idReservaSuite: params.idReservaSuite,
        },
    });
    if (!servico) {
        throw new CustomError('Serviço não encontrado.', 404, '');
    }

    await connection.transaction(async (transaction: Transaction) => {
        await servico.update({ descricao, valor }, { transaction });

        await recalcularFinanceiroReservaComServicos(
            params.idReservaHospedagem,
            transaction,
            {
                idUsuarioHistorico: params.idUsuario,
                descricaoHistorico: `Serviço adicional alterado: ${descricao} (${valor.toFixed(2)})`,
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

export async function excluirServicoSuiteReserva(params: {
    idReservaHospedagem: number;
    idReservaSuite: number;
    idServico: number;
    idUsuario: number;
}) {
    await carregarContextoServico({
        idReservaHospedagem: params.idReservaHospedagem,
        idReservaSuite: params.idReservaSuite,
        idUsuario: params.idUsuario,
        exigePermissao: 'excluir',
    });

    const servico = await ReservaSuiteItemServico.findOne({
        where: {
            id: params.idServico,
            idReservaSuite: params.idReservaSuite,
        },
    });
    if (!servico) {
        throw new CustomError('Serviço não encontrado.', 404, '');
    }

    const descricaoRemovida = servico.descricao;

    await connection.transaction(async (transaction: Transaction) => {
        await servico.destroy({ transaction });

        await recalcularFinanceiroReservaComServicos(
            params.idReservaHospedagem,
            transaction,
            {
                idUsuarioHistorico: params.idUsuario,
                descricaoHistorico: `Serviço adicional removido: ${descricaoRemovida}`,
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

export async function obterPermissoesServicosUsuario(
    idUsuario: number
): Promise<PermissoesServicosSuite> {
    const escopo = await resolverEscopoProdutor(idUsuario);
    return resolverPermissoesServicosSuite(escopo);
}

export { mapServicoDto };
