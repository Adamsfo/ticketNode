/**
 * Reconciliação de ReservaHospede.idUsuario em UPDATEs Hospedin.
 *
 * Garante: com CPF válido no payload/documentos, nunca permanece
 * vinculado a Usuário Técnico. Técnico NÃO é excluído — só desvinculado.
 */

import { ReservaHospedeDocumento } from '../../../models/ReservaHospedeDocumento';
import type { GuestResolveResult } from '../../../services/GuestResolverService';
import { pickGuestCpf } from '../../../utils/guestCpf';
import type { ReservationDiffChange } from './ReservationDiffService';
import type { ReservationDiffSnapshot } from './ReservationDiffService';

export type DesiredGuestForRelink = {
    nome: string;
    tipo: string;
    dataNascimento?: string | null;
    cpf?: string | null;
    email?: string | null;
    telefone?: string | null;
    documentos?: Array<{ tipo?: string | null; numero?: string | null }> | null;
};

export type HospedeRowLike = {
    id: number;
    nome?: string;
    tipo?: string;
    dataNascimento?: Date | string | null;
    idUsuario?: number | null;
    update: (values: { idUsuario: number }) => Promise<unknown>;
};

/**
 * Decide se o vínculo deve mudar.
 * Idempotente: mesmo CPF → mesmo Usuario → false.
 */
export function shouldRelinkHospedeUsuario(
    previousIdUsuario: number | null | undefined,
    resolved: Pick<GuestResolveResult, 'idUsuario' | 'isTechnical'>
): boolean {
    if (resolved.idUsuario == null) return false;
    if (previousIdUsuario == null) return true;
    return Number(previousIdUsuario) !== Number(resolved.idUsuario);
}

/**
 * Extrai CPF a usar no resolve: payload do desired + documentos já gravados.
 */
export function resolveCpfForHospedeRelink(input: {
    desiredCpf?: string | null;
    documents?: Array<{ tipo?: string | null; numero?: string | null }> | null;
}): string | null {
    const picked = pickGuestCpf({
        cpf: input.desiredCpf,
        documents: input.documents,
    });
    return picked.cpf;
}

/**
 * Escolhe o titular (primeiro adulto não-técnico; senão primeiro adulto).
 */
export function pickTitularIdUsuario(
    guests: Array<{
        tipo?: string | null;
        idUsuario?: number | null;
        isTechnical?: boolean;
    }>
): number | null {
    let fallback: number | null = null;
    for (const g of guests) {
        if (!String(g.tipo || '').toLowerCase().includes('adulto')) continue;
        if (g.idUsuario == null) continue;
        const id = Number(g.idUsuario);
        if (!g.isTechnical) return id;
        if (fallback == null) fallback = id;
    }
    return fallback;
}

export type RelinkDeps = {
    guestResolverService: {
        resolveGuest: (
            input: {
                nome: string;
                tipo: string;
                dataNascimento?: Date | null;
                cpf?: string | null;
                email?: string | null;
                telefone?: string | null;
                documentos?: Array<{
                    tipo?: string | null;
                    numero?: string | null;
                }> | null;
            },
            meta?: {
                reservationId?: number;
                correlationId?: string;
                previousIdUsuario?: number | null;
            }
        ) => Promise<GuestResolveResult>;
        clearCache: () => void;
    };
    loadDocumentos: (
        idReservaHospede: number
    ) => Promise<Array<{ tipo?: string | null; numero?: string | null }>>;
    updateHospedagemUsuario: (idUsuario: number) => Promise<void>;
    currentHospedagemIdUsuario: number | null;
    reservationId?: number;
    correlationId?: string;
    onRelink?: (info: {
        hospedeNome: string;
        before: number | null;
        after: number;
        action: string;
    }) => void;
};

/**
 * Para cada hóspede desired[i] ↔ row[i]: resolve CPF e atualiza idUsuario.
 * Não exclui Usuário Técnico.
 */
export async function relinkHospedesFromDesired(input: {
    rows: HospedeRowLike[];
    desiredGuests: DesiredGuestForRelink[];
    deps: RelinkDeps;
}): Promise<ReservationDiffChange[]> {
    const changes: ReservationDiffChange[] = [];
    const { rows, desiredGuests, deps } = input;
    deps.guestResolverService.clearCache();

    const resolvedForTitular: Array<{
        tipo?: string;
        idUsuario?: number | null;
        isTechnical?: boolean;
    }> = [];

    const n = Math.max(desiredGuests.length, rows.length);
    for (let i = 0; i < n; i++) {
        const g = desiredGuests[i];
        const row = rows[i];
        if (!g || !row) continue;

        const previousId =
            row.idUsuario != null ? Number(row.idUsuario) : null;

        const docs = await deps.loadDocumentos(Number(row.id));
        const cpf = resolveCpfForHospedeRelink({
            desiredCpf: g.cpf,
            documents: [
                ...(g.documentos || []),
                ...docs,
            ],
        });

        const resolved = await deps.guestResolverService.resolveGuest(
            {
                nome: g.nome,
                tipo: g.tipo,
                dataNascimento: g.dataNascimento
                    ? new Date(g.dataNascimento)
                    : row.dataNascimento
                      ? new Date(row.dataNascimento)
                      : null,
                cpf,
                email: g.email ?? null,
                telefone: g.telefone ?? null,
                documentos: docs,
            },
            {
                reservationId: deps.reservationId,
                correlationId: deps.correlationId,
                previousIdUsuario: previousId,
            }
        );

        resolvedForTitular.push({
            tipo: g.tipo,
            idUsuario: resolved.idUsuario,
            isTechnical: resolved.isTechnical,
        });

        if (shouldRelinkHospedeUsuario(previousId, resolved)) {
            await row.update({ idUsuario: resolved.idUsuario });
            changes.push({
                field: 'hospede.idUsuario',
                before: previousId,
                after: resolved.idUsuario,
            });
            deps.onRelink?.({
                hospedeNome: g.nome,
                before: previousId,
                after: resolved.idUsuario,
                action: resolved.action,
            });
        }
    }

    const titularId = pickTitularIdUsuario(resolvedForTitular);
    if (
        titularId != null &&
        Number(deps.currentHospedagemIdUsuario) !== Number(titularId)
    ) {
        const beforeTitular = deps.currentHospedagemIdUsuario;
        await deps.updateHospedagemUsuario(titularId);
        changes.push({
            field: 'hospedagem.idUsuario',
            before: beforeTitular,
            after: titularId,
        });
    }

    return changes;
}

export async function loadDocumentosForHospede(
    idReservaHospede: number
): Promise<Array<{ tipo?: string | null; numero?: string | null }>> {
    const docs = await ReservaHospedeDocumento.findAll({
        where: { idReservaHospede },
    });
    return docs.map((d) => ({ tipo: d.tipo, numero: d.numero }));
}

export function desiredGuestsFromSnapshot(
    desired: ReservationDiffSnapshot
): DesiredGuestForRelink[] {
    return (desired.hospedes || []).map((g) => ({
        nome: g.nome,
        tipo: g.tipo,
        dataNascimento: g.dataNascimento,
        cpf: g.cpf ?? null,
        email: g.email ?? null,
        telefone: g.telefone ?? null,
    }));
}
