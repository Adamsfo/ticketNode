import { Op } from "sequelize";

/** Status persistidos em `Ingresso.status` (ENUM do model). */
export const INGRESSO_STATUS_UTILIZADO = "Utilizado";
export const INGRESSO_STATUS_CANCELADO = "Cancelado";

const STATUS_EXCLUIDOS_LISTAGEM_CORTESIA = [
    INGRESSO_STATUS_UTILIZADO,
    INGRESSO_STATUS_CANCELADO,
];

/**
 * Flag enviada pela aba Cortesias em `filters.excluirUtilizadoCancelado`.
 * Deve ser removida antes do parse genérico de filtros em getRegistros.
 */
export function deveExcluirUtilizadoCanceladoListagemCortesia(
    filters: Record<string, unknown> | null | undefined,
): boolean {
    if (!filters || typeof filters !== "object") {
        return false;
    }
    const flag = filters.excluirUtilizadoCancelado;
    return flag === true || flag === "true" || flag === 1 || flag === "1";
}

export function buildWhereExcluirUtilizadoCanceladoListagemCortesia() {
    return {
        status: { [Op.notIn]: STATUS_EXCLUIDOS_LISTAGEM_CORTESIA },
    };
}
