import { formatInTimeZone } from 'date-fns-tz';
import type { HospedeCheckoutItem } from '../../../services/reservaSuiteService';
import { TZ_HOSPEDAGEM } from '../../../utils/reservaSuiteUtils';

export type ReservationDiffChange = {
    field: string;
    before: unknown;
    after: unknown;
};

export type ReservationDiffSnapshot = {
    checkin: Date | null;
    checkout: Date | null;
    idEventoSuite: number | null;
    observacoes: string | null;
    adultos: number;
    criancas: number;
    hospedes: Array<{
        nome: string;
        tipo: string;
        dataNascimento: string | null;
        cpf?: string | null;
        email?: string | null;
        telefone?: string | null;
    }>;
};

export type ReservationDiffResult = {
    hasChanges: boolean;
    changes: ReservationDiffChange[];
    before: ReservationDiffSnapshot;
    after: ReservationDiffSnapshot;
};

function dayKey(d: Date | null | undefined): string | null {
    if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

/** Data+hora no fuso da pousada — detecta troca de horário padrão (ex.: 14:00 → 16:00). */
function periodKey(d: Date | null | undefined): string | null {
    if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return null;
    return formatInTimeZone(d, TZ_HOSPEDAGEM, "yyyy-MM-dd'T'HH:mm");
}

function normObs(v: string | null | undefined): string | null {
    const s = String(v || '').trim();
    return s ? s : null;
}

function normGuests(list: HospedeCheckoutItem[] | undefined) {
    return (list || [])
        .map((g) => ({
            nome: String(g.nome || '').trim(),
            tipo: String(g.tipo || ''),
            dataNascimento: g.dataNascimento
                ? dayKey(
                      g.dataNascimento instanceof Date
                          ? g.dataNascimento
                          : new Date(g.dataNascimento)
                  )
                : null,
        }))
        .filter((g) => g.nome)
        .sort((a, b) =>
            `${a.nome}|${a.tipo}|${a.dataNascimento || ''}`.localeCompare(
                `${b.nome}|${b.tipo}|${b.dataNascimento || ''}`
            )
        );
}

/**
 * Compara snapshot Jango × intenção Hospedin (já normalizada).
 * Não aplica alterações. Não conhece DTO cru da API.
 */
export class ReservationDiffService {
    diff(
        before: ReservationDiffSnapshot,
        after: ReservationDiffSnapshot
    ): ReservationDiffResult {
        const changes: ReservationDiffChange[] = [];

        if (periodKey(before.checkin) !== periodKey(after.checkin)) {
            changes.push({
                field: 'checkin',
                before: periodKey(before.checkin),
                after: periodKey(after.checkin),
            });
        }
        if (periodKey(before.checkout) !== periodKey(after.checkout)) {
            changes.push({
                field: 'checkout',
                before: periodKey(before.checkout),
                after: periodKey(after.checkout),
            });
        }
        if (Number(before.idEventoSuite) !== Number(after.idEventoSuite)) {
            changes.push({
                field: 'idEventoSuite',
                before: before.idEventoSuite,
                after: after.idEventoSuite,
            });
        }
        if (normObs(before.observacoes) !== normObs(after.observacoes)) {
            changes.push({
                field: 'observacoes',
                before: normObs(before.observacoes),
                after: normObs(after.observacoes),
            });
        }
        if (Number(before.adultos) !== Number(after.adultos)) {
            changes.push({
                field: 'adultos',
                before: before.adultos,
                after: after.adultos,
            });
        }
        if (Number(before.criancas) !== Number(after.criancas)) {
            changes.push({
                field: 'criancas',
                before: before.criancas,
                after: after.criancas,
            });
        }

        const gBefore = normGuests(before.hospedes as any);
        const gAfter = normGuests(after.hospedes as any);
        if (JSON.stringify(gBefore) !== JSON.stringify(gAfter)) {
            changes.push({
                field: 'hospedes',
                before: gBefore,
                after: gAfter,
            });
        }

        return {
            hasChanges: changes.length > 0,
            changes,
            before,
            after,
        };
    }
}

export const reservationDiffService = new ReservationDiffService();
