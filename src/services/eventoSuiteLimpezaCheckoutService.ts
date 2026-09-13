import { Transaction } from 'sequelize';
import { EventoSuite } from '../models/EventoSuite';
import {
    EventoSuiteLimpeza,
    OrigemEventoSuiteLimpeza,
    StatusEventoSuiteLimpeza,
} from '../models/EventoSuiteLimpeza';
import { buscarLimpezaAbertaNaSuite } from './eventoSuiteLimpezaCheckinService';

export type ReservaSuiteCheckoutLimpezaInput = {
    id: number;
    idEventoSuite: number;
};

export type LimpezaPendenteCheckoutPayload = {
    idReservaHospedagem: number;
    idReservaSuite: number;
    idEventoSuite: number;
    status: StatusEventoSuiteLimpeza.Pendente;
};

/** Monta um registro Pendente por linha ReservaSuite do checkout. */
export function montarLimpezasPendentesCheckout(
    idReservaHospedagem: number,
    suites: ReservaSuiteCheckoutLimpezaInput[]
): LimpezaPendenteCheckoutPayload[] {
    return suites.map((suite) => ({
        idReservaHospedagem,
        idReservaSuite: suite.id,
        idEventoSuite: suite.idEventoSuite,
        status: StatusEventoSuiteLimpeza.Pendente,
    }));
}

/**
 * Cria limpezas Pendentes na mesma transação do checkout.
 * Idempotente via:
 * - skip quando já existe limpeza aberta (Pendente/EmAndamento) na suíte (qualquer origem);
 * - findOrCreate + UNIQUE (id_reserva_hospedagem, id_evento_suite) quando não há aberta.
 */
export async function criarLimpezasPendentesNoCheckout(
    transaction: Transaction,
    idReservaHospedagem: number,
    suites: ReservaSuiteCheckoutLimpezaInput[]
): Promise<void> {
    const payloads = montarLimpezasPendentesCheckout(
        idReservaHospedagem,
        suites
    );

    for (const payload of payloads) {
        const suite = await EventoSuite.findByPk(payload.idEventoSuite, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });
        if (!suite) continue;

        const limpezaAberta = await buscarLimpezaAbertaNaSuite(
            payload.idEventoSuite,
            { transaction, lock: true }
        );
        if (limpezaAberta) continue;

        await EventoSuiteLimpeza.findOrCreate({
            where: {
                idReservaHospedagem: payload.idReservaHospedagem,
                idEventoSuite: payload.idEventoSuite,
            },
            defaults: {
                idReservaHospedagem: payload.idReservaHospedagem,
                idEventoSuite: payload.idEventoSuite,
                idReservaSuite: payload.idReservaSuite,
                status: StatusEventoSuiteLimpeza.Pendente,
                origem: OrigemEventoSuiteLimpeza.Checkout,
            },
            transaction,
        });
    }
}
