import { ReservaSuite } from '../../../models/ReservaSuite';

type SuiteLine = ReservaSuite & {
    hospedinReservationId?: string | null;
};

/**
 * Resolve o ID Hospedin já vinculado a uma linha de suíte (idempotência CREATE).
 * Legado: reserva com 1 suíte pode ter somente ReservaHospedagem.idExterno.
 * Multi-suíte: idExterno da reserva só vale para a 1ª linha quando nenhuma suíte tem ID.
 */
export function resolveSuiteExistingHospedinReservationId(input: {
    linha: SuiteLine;
    suiteIndex: number;
    suites: SuiteLine[];
    reservaIdExterno?: string | null;
    queueReservationId?: string | null;
}): string | null {
    const fromSuite = String(input.linha.hospedinReservationId || '').trim();
    if (fromSuite) {
        return fromSuite;
    }

    const legacyReservaId = String(input.reservaIdExterno || '').trim();
    const legacyQueueId = String(input.queueReservationId || '').trim();
    const legacyId = legacyReservaId || legacyQueueId;
    if (!legacyId) {
        return null;
    }

    if (input.suites.length === 1) {
        return legacyId;
    }

    if (input.suiteIndex !== 0) {
        return null;
    }

    const anySuiteHasId = input.suites.some((suite) =>
        Boolean(String(suite.hospedinReservationId || '').trim())
    );
    if (anySuiteHasId) {
        return null;
    }

    return legacyId;
}
