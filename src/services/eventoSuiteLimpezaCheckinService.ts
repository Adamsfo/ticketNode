import { Op } from 'sequelize';
import {
    EventoSuiteLimpeza,
    StatusEventoSuiteLimpeza,
    isLimpezaAberta,
} from '../models/EventoSuiteLimpeza';
import { EventoSuite } from '../models/EventoSuite';
import { CustomError } from '../utils/customError';

export type LimpezaSuiteCheckinInput = {
    idEventoSuite: number;
    status: string;
};

/**
 * Avalia se alguma suíte da reserva possui limpeza aberta (Pendente/EmAndamento).
 * Não altera disponibilidade — apenas autorização de check-in.
 */
export function avaliarLimpezasParaCheckin(
    idEventoSuites: number[],
    limpezas: LimpezaSuiteCheckinInput[]
): { bloqueado: boolean; idEventoSuite?: number; status?: string } {
    const ids = new Set(idEventoSuites);
    for (const limpeza of limpezas) {
        if (!ids.has(limpeza.idEventoSuite)) continue;
        if (isLimpezaAberta(limpeza.status)) {
            return {
                bloqueado: true,
                idEventoSuite: limpeza.idEventoSuite,
                status: limpeza.status,
            };
        }
    }
    return { bloqueado: false };
}

export function mensagemLimpezaBloqueiaCheckin(
    idEventoSuite: number,
    status: string,
    nomeSuite?: string | null
): string {
    const rotulo = nomeSuite?.trim() || `suíte #${idEventoSuite}`;
    const fase =
        status === StatusEventoSuiteLimpeza.EmAndamento
            ? 'em andamento'
            : 'pendente';
    return `Não é possível realizar o check-in: ${rotulo} ainda está em limpeza (${fase}).`;
}

/**
 * Bloqueia check-in se existir limpeza Pendente ou EmAndamento na EventoSuite.
 */
export async function assertSuitesSemLimpezaAbertaParaCheckin(
    idEventoSuites: number[]
): Promise<void> {
    const ids = [...new Set(idEventoSuites.filter((id) => id > 0))];
    if (ids.length === 0) return;

    const limpezaAberta = (await EventoSuiteLimpeza.findOne({
        where: {
            idEventoSuite: { [Op.in]: ids },
            status: {
                [Op.in]: [
                    StatusEventoSuiteLimpeza.Pendente,
                    StatusEventoSuiteLimpeza.EmAndamento,
                ],
            },
        },
        include: [
            {
                model: EventoSuite,
                as: 'EventoSuite',
                attributes: ['nome'],
                required: false,
            },
        ],
    })) as
        | (EventoSuiteLimpeza & {
              EventoSuite?: { nome?: string | null } | null;
          })
        | null;

    if (!limpezaAberta) return;

    throw new CustomError(
        mensagemLimpezaBloqueiaCheckin(
            limpezaAberta.idEventoSuite,
            limpezaAberta.status,
            limpezaAberta.EventoSuite?.nome
        ),
        400,
        ''
    );
}
