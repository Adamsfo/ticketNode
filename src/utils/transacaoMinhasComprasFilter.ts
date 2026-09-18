import { Op, literal } from 'sequelize';
import { OrigemTransacao } from '../models/Transacao';

/**
 * Listagem de Minhas Compras usa GET /transacao com filtro por idUsuario + status,
 * sem filtro por id específico. PDV e conferência consultam por id da transação.
 */
export function deveExcluirHospedagemDaListagemMinhasCompras(
    filters: Record<string, unknown> | null | undefined
): boolean {
    if (!filters || typeof filters !== 'object') {
        return false;
    }

    const idUsuario = filters.idUsuario;
    const temIdUsuario =
        idUsuario !== undefined &&
        idUsuario !== null &&
        String(idUsuario).trim() !== '';

    const idTransacao = filters.id;
    const temIdEspecifico =
        idTransacao !== undefined &&
        idTransacao !== null &&
        String(idTransacao).trim() !== '';

    return temIdUsuario && !temIdEspecifico;
}

/**
 * Identifica transação de hospedagem por vínculos estruturais (não por nome do evento).
 * Cobre registros novos (origem_transacao) e históricos (ReservaHospedagem / EventoSuiteTransacao).
 */
export function ehTransacaoHospedagem(params: {
    origemTransacao?: OrigemTransacao | string | null;
    vinculadaReservaHospedagem?: boolean;
    vinculadaEventoSuiteTransacao?: boolean;
}): boolean {
    if (params.origemTransacao === OrigemTransacao.HOSPEDAGEM) {
        return true;
    }
    if (params.vinculadaReservaHospedagem) {
        return true;
    }
    if (params.vinculadaEventoSuiteTransacao) {
        return true;
    }
    return false;
}

/** Condição Sequelize para excluir transações de hospedagem em listagens de compras. */
export function buildWhereExcluirTransacaoHospedagem() {
    return {
        [Op.and]: [
            {
                [Op.not]: {
                    [Op.or]: [
                        { origemTransacao: OrigemTransacao.HOSPEDAGEM },
                        literal(
                            `EXISTS (SELECT 1 FROM ReservaHospedagem rh WHERE rh.id_transacao = Transacao.id)`
                        ),
                        literal(
                            `EXISTS (SELECT 1 FROM EventoSuiteTransacao est WHERE est.id_transacao = Transacao.id)`
                        ),
                    ],
                },
            },
        ],
    };
}
