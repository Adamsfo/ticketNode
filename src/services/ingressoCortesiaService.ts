import { Op, Transaction } from "sequelize";
import {
    HistoricoIngresso,
    Ingresso,
    TipoVendidoCortesia,
} from "../models/Ingresso";
import { Evento } from "../models/Evento";
import { EventoIngresso } from "../models/EventoIngresso";
import { TipoIngresso } from "../models/TipoIngresso";
import { Usuario } from "../models/Usuario";
import { CustomError } from "../utils/customError";
import { buildIngressoSearchConditions } from "../utils/ingressoSearch";
import {
    buildWhereExcluirUtilizadoCanceladoListagemCortesia,
    INGRESSO_STATUS_CANCELADO,
    INGRESSO_STATUS_UTILIZADO,
} from "../utils/ingressoCortesiaListagemFilter";

const STATUS_PERMITIDOS_CANCELAMENTO = ["Confirmado", "Reservado"] as const;

const CORTESIA_INCLUDES = [
    {
        model: Evento,
        as: "Evento",
        attributes: ["nome", "imagem", "data_hora_inicio", "endereco"],
    },
    {
        model: EventoIngresso,
        as: "EventoIngresso",
        attributes: ["nome"],
    },
    {
        model: TipoIngresso,
        as: "TipoIngresso",
        attributes: ["descricao"],
    },
    {
        model: Usuario,
        as: "Usuario",
        attributes: ["nomeCompleto", "cpf", "email"],
    },
];

export function normalizarBuscaCortesia(raw: unknown): string {
    if (raw == null || raw === "" || String(raw).toLowerCase() === "undefined") {
        return "";
    }
    return String(raw).trim();
}

function flattenIngressoRow(
    row: Ingresso,
    includeOptions: typeof CORTESIA_INCLUDES,
): Record<string, unknown> {
    const plainRow = row.get({ plain: true }) as unknown as Record<string, unknown>;

    includeOptions.forEach((option) => {
        const as = option.as;
        const associatedData = plainRow[as];
        if (associatedData && typeof associatedData === "object") {
            Object.keys(associatedData as object).forEach((key) => {
                plainRow[`${as}_${key}`] = (associatedData as Record<string, unknown>)[key];
            });
        } else if (option.attributes) {
            option.attributes.forEach((attr) => {
                plainRow[`${as}_${attr}`] = null;
            });
        }
        delete plainRow[as];
    });

    return plainRow;
}

export type ListarCortesiasPainelParams = {
    idEvento: number;
    page: number;
    pageSize: number;
    search?: string;
};

export async function listarCortesiasPainel(params: ListarCortesiasPainelParams) {
    const idEvento = Number(params.idEvento);
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));
    const search = normalizarBuscaCortesia(params.search);

    if (!idEvento || idEvento <= 0) {
        throw new CustomError("ID do evento é obrigatório.", 400, "");
    }

    const searchOr = search ? buildIngressoSearchConditions(search) : [];
    const searchCondition =
        searchOr.length > 0 ? { [Op.or]: searchOr } : {};

    const whereCondition = {
        idEvento,
        tipo: TipoVendidoCortesia.Cortesia,
        ...buildWhereExcluirUtilizadoCanceladoListagemCortesia(),
        ...searchCondition,
    };

    const offset = (page - 1) * pageSize;

    const { count, rows } = await Ingresso.findAndCountAll({
        where: whereCondition,
        offset,
        limit: pageSize,
        order: [["id", "DESC"]],
        include: CORTESIA_INCLUDES,
        distinct: true,
    });

    const data = rows.map((row) => flattenIngressoRow(row, CORTESIA_INCLUDES));
    const totalPages = Math.max(1, Math.ceil(count / pageSize));

    return {
        data,
        meta: {
            totalItems: count,
            totalPages,
            currentPage: page,
            pageSize,
        },
    };
}

export async function cancelarCortesia(
    idIngresso: number,
    idUsuario: number,
): Promise<Ingresso> {
    if (!idIngresso || idIngresso <= 0) {
        throw new CustomError("ID da cortesia é obrigatório.", 400, "");
    }
    if (!idUsuario || idUsuario <= 0) {
        throw new CustomError("Usuário responsável é obrigatório.", 400, "");
    }

    const connection = (await import("../database")).default;

    return connection.transaction(async (transaction: Transaction) => {
        const ingresso = await Ingresso.findByPk(idIngresso, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!ingresso) {
            throw new CustomError("Cortesia não encontrada.", 404, "");
        }

        if (ingresso.tipo !== TipoVendidoCortesia.Cortesia) {
            throw new CustomError(
                "O registro informado não é uma cortesia.",
                400,
                "",
            );
        }

        if (ingresso.status === INGRESSO_STATUS_CANCELADO) {
            throw new CustomError("Esta cortesia já está cancelada.", 400, "");
        }

        if (ingresso.status === INGRESSO_STATUS_UTILIZADO) {
            throw new CustomError(
                "Não é permitido cancelar uma cortesia já utilizada.",
                400,
                "",
            );
        }

        if (
            !STATUS_PERMITIDOS_CANCELAMENTO.includes(
                ingresso.status as (typeof STATUS_PERMITIDOS_CANCELAMENTO)[number],
            )
        ) {
            throw new CustomError(
                `Não é permitido cancelar cortesia com status "${ingresso.status}".`,
                400,
                "",
            );
        }

        ingresso.status = INGRESSO_STATUS_CANCELADO;
        await ingresso.save({ transaction });

        await HistoricoIngresso.create(
            {
                idIngresso: ingresso.id,
                idUsuario,
                data: new Date(),
                descricao: "Cortesia cancelada pelo painel.",
            },
            { transaction },
        );

        return ingresso;
    });
}
