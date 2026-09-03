import { Transaction } from 'sequelize';
import {
    EventoSuiteLimpeza,
    StatusEventoSuiteLimpeza,
} from '../models/EventoSuiteLimpeza';

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
 * Idempotente via findOrCreate + UNIQUE (id_reserva_hospedagem, id_evento_suite).
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
            },
            transaction,
        });
    }
}
