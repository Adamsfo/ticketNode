import type { HospedeCheckoutItem } from '../../../services/reservaSuiteService';
import type {
    ReservationDiffResult,
    ReservationDiffSnapshot,
} from './ReservationDiffService';

/**
 * Patch de domínio Jango — sem campos financeiros.
 * Consumido apenas por ReservationUpdateService.
 */
export type ReservationPatch = {
    checkin?: Date;
    checkout?: Date;
    idEventoSuite?: number;
    observacoes?: string | null;
    adultos?: number;
    criancas?: number;
    /** Replace completo da lista de hóspedes. */
    hospedesReplace?: HospedeCheckoutItem[];
};

/**
 * Converte Diff + snapshot "after" em ReservationPatch.
 * Isola o UpdateService de DTOs Hospedin.
 */
export class ReservationPatchBuilder {
    buildFromDiff(diff: ReservationDiffResult): ReservationPatch {
        if (!diff.hasChanges) return {};

        const after = diff.after;
        const fields = new Set(diff.changes.map((c) => c.field));
        const patch: ReservationPatch = {};

        if (fields.has('checkin') && after.checkin) {
            patch.checkin = after.checkin;
        }
        if (fields.has('checkout') && after.checkout) {
            patch.checkout = after.checkout;
        }
        if (fields.has('idEventoSuite') && after.idEventoSuite != null) {
            patch.idEventoSuite = Number(after.idEventoSuite);
        }
        if (fields.has('observacoes')) {
            patch.observacoes = after.observacoes;
        }
        if (fields.has('adultos')) {
            patch.adultos = Number(after.adultos);
        }
        if (fields.has('criancas')) {
            patch.criancas = Number(after.criancas);
        }
        if (fields.has('hospedes')) {
            patch.hospedesReplace = (after.hospedes || []).map((g) => ({
                nome: g.nome,
                tipo: g.tipo as any,
                dataNascimento: g.dataNascimento
                    ? new Date(g.dataNascimento)
                    : null,
                cpf: g.cpf ?? null,
                email: g.email ?? null,
                telefone: g.telefone ?? null,
            }));
        }

        return patch;
    }

    /** Atalho: monta patch direto do snapshot desejado (todos campos operacionais). */
    buildFullOperational(after: ReservationDiffSnapshot): ReservationPatch {
        return {
            checkin: after.checkin || undefined,
            checkout: after.checkout || undefined,
            idEventoSuite:
                after.idEventoSuite != null
                    ? Number(after.idEventoSuite)
                    : undefined,
            observacoes: after.observacoes,
            adultos: Number(after.adultos),
            criancas: Number(after.criancas),
            hospedesReplace: (after.hospedes || []).map((g) => ({
                nome: g.nome,
                tipo: g.tipo as any,
                dataNascimento: g.dataNascimento
                    ? new Date(g.dataNascimento)
                    : null,
                cpf: g.cpf ?? null,
                email: g.email ?? null,
                telefone: g.telefone ?? null,
            })),
        };
    }
}

export const reservationPatchBuilder = new ReservationPatchBuilder();
