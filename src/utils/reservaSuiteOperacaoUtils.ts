import { StatusReservaHospedagem } from '../models/ReservaHospedagem';
import {
    ReservaSuite,
    StatusReservaSuite,
} from '../models/ReservaSuite';
import type { StatusReservaDisponibilidade } from '../services/suiteDisponibilidadeService';

export type LinhaOperacionalSuite = Pick<
    ReservaSuite,
    | 'status'
    | 'dataHoraChegadaReal'
    | 'dataHoraCheckinReal'
    | 'dataHoraCheckoutRealizado'
>;

export type ReservaOperacionalAgregada = {
    status: StatusReservaHospedagem | string;
    dataHoraChegadaReal?: Date | null;
    dataHoraCheckinReal?: Date | null;
    dataHoraCheckoutRealizado?: Date | null;
};

const MAP_SUITE_STATUS: Record<string, StatusReservaDisponibilidade> = {
    AguardandoPagamento: 'AguardandoPagamento',
    Confirmada: 'Confirmada',
    Hospedada: 'Hospedada',
    CheckOutRealizado: 'CheckOutRealizado',
    Cancelada: 'Cancelada',
    Expirada: 'Expirada',
};

/** Compatibilidade mono-suíte legada: usa campos da ReservaHospedagem quando há uma linha. */
export function reservaMonoSuite(totalSuitesNaReserva: number): boolean {
    return totalSuitesNaReserva <= 1;
}

export function resolverChegadaLinhaSuite(
    linha: LinhaOperacionalSuite,
    reserva: ReservaOperacionalAgregada,
    totalSuitesNaReserva: number
): Date | null {
    if (linha.dataHoraChegadaReal) {
        return linha.dataHoraChegadaReal;
    }
    if (
        reservaMonoSuite(totalSuitesNaReserva) &&
        reserva.dataHoraChegadaReal
    ) {
        return reserva.dataHoraChegadaReal;
    }
    return null;
}

export function resolverCheckinLinhaSuite(
    linha: LinhaOperacionalSuite,
    reserva: ReservaOperacionalAgregada,
    totalSuitesNaReserva: number
): Date | null {
    if (linha.dataHoraCheckinReal) {
        return linha.dataHoraCheckinReal;
    }
    if (
        reservaMonoSuite(totalSuitesNaReserva) &&
        reserva.dataHoraCheckinReal
    ) {
        return reserva.dataHoraCheckinReal;
    }
    return null;
}

export function resolverCheckoutLinhaSuite(
    linha: LinhaOperacionalSuite,
    reserva: ReservaOperacionalAgregada,
    totalSuitesNaReserva: number
): Date | null {
    if (linha.dataHoraCheckoutRealizado) {
        return linha.dataHoraCheckoutRealizado;
    }
    if (
        reservaMonoSuite(totalSuitesNaReserva) &&
        reserva.dataHoraCheckoutRealizado
    ) {
        return reserva.dataHoraCheckoutRealizado;
    }
    return null;
}

export function resolverStatusOperacionalLinhaSuite(
    linha: LinhaOperacionalSuite,
    reserva: ReservaOperacionalAgregada,
    totalSuitesNaReserva: number
): StatusReservaDisponibilidade {
    if (linha.status === StatusReservaSuite.Hospedada) {
        return 'Hospedada';
    }
    if (linha.status === StatusReservaSuite.CheckOutRealizado) {
        return 'CheckOutRealizado';
    }
    if (linha.status === StatusReservaSuite.Cancelada) {
        return 'Cancelada';
    }
    if (linha.status === StatusReservaSuite.Expirada) {
        return 'Expirada';
    }
    if (linha.status === StatusReservaSuite.AguardandoPagamento) {
        return 'AguardandoPagamento';
    }

    const checkinLinha = resolverCheckinLinhaSuite(
        linha,
        reserva,
        totalSuitesNaReserva
    );
    if (checkinLinha) {
        return 'Hospedada';
    }

    if (
        reservaMonoSuite(totalSuitesNaReserva) &&
        reserva.status === StatusReservaHospedagem.Hospedada &&
        reserva.dataHoraCheckinReal
    ) {
        return 'Hospedada';
    }

    return MAP_SUITE_STATUS[String(linha.status)] ?? 'Confirmada';
}

export function linhaSuiteTemChegadaRegistrada(
    linha: LinhaOperacionalSuite,
    reserva: ReservaOperacionalAgregada,
    totalSuitesNaReserva: number
): boolean {
    return Boolean(
        resolverChegadaLinhaSuite(linha, reserva, totalSuitesNaReserva)
    );
}

export function linhaSuiteCheckinRealizado(
    linha: LinhaOperacionalSuite,
    reserva: ReservaOperacionalAgregada,
    totalSuitesNaReserva: number
): boolean {
    const status = resolverStatusOperacionalLinhaSuite(
        linha,
        reserva,
        totalSuitesNaReserva
    );
    return (
        status === 'Hospedada' ||
        Boolean(
            resolverCheckinLinhaSuite(linha, reserva, totalSuitesNaReserva)
        )
    );
}

export function todasLinhasReservaHospedadas(
    linhas: Array<Pick<ReservaSuite, 'status'>>
): boolean {
    return (
        linhas.length > 0 &&
        linhas.every((linha) => linha.status === StatusReservaSuite.Hospedada)
    );
}

export function todasLinhasReservaCheckoutRealizado(
    linhas: Array<Pick<ReservaSuite, 'status'>>
): boolean {
    return (
        linhas.length > 0 &&
        linhas.every(
            (linha) => linha.status === StatusReservaSuite.CheckOutRealizado
        )
    );
}
