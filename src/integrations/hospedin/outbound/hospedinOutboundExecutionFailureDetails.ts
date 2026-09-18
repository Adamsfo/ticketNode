import { Op } from 'sequelize';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaHospede } from '../../../models/ReservaHospede';
import { ReservaSuite } from '../../../models/ReservaSuite';
import { Usuario } from '../../../models/Usuario';

export type OutboundFailedReservationDetail = {
    idReservaHospedagem: number;
    idOutboundState: number;
    hospedinReservationId: string | null;
    hospedinIdExterno: string | null;
    nomeHospede: string | null;
    checkin: string | null;
    checkout: string | null;
    operacao: string;
    outcome: string;
    mensagemErro: string | null;
    errorCode: string | null;
    httpStatus: number | null;
    correlationId: string;
};

export type OutboundFailureDraft = {
    idOutboundState: number;
    idReservaHospedagem: number;
    operacao: string;
    outcome: string;
    hospedinReservationId?: string | null;
    mensagemErro?: string | null;
    errorCode?: string | null;
    httpStatus?: number | null;
    correlationId: string;
};

export function isOutboundFailureOutcome(outcome: string): boolean {
    const normalized = String(outcome || '').trim().toLowerCase();
    return (
        normalized === 'failed' ||
        normalized === 'retry' ||
        normalized === 'error'
    );
}

export function parseHttpStatusFromErrorCode(
    errorCode: string | null | undefined
): number | null {
    const code = String(errorCode || '').trim();
    const match = /^HTTP_(\d{3})$/.exec(code);
    return match ? Number(match[1]) : null;
}

export function resolveOutboundHttpStatus(input: {
    httpStatus?: number | null;
    errorCode?: string | null;
}): number | null {
    if (input.httpStatus != null && Number.isFinite(Number(input.httpStatus))) {
        return Number(input.httpStatus);
    }
    return parseHttpStatusFromErrorCode(input.errorCode);
}

function titularGuestName(
    hospedes: Array<{ nome?: string | null }>
): string | null {
    for (const hospede of hospedes) {
        const nome = String(hospede.nome || '').trim();
        if (nome) {
            return nome;
        }
    }
    return null;
}

function formatUsuarioGuestName(
    usuario: { nomeCompleto?: string | null; sobreNome?: string | null } | null
): string | null {
    if (!usuario) {
        return null;
    }
    const nome = [usuario.nomeCompleto, usuario.sobreNome]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join(' ')
        .trim();
    return nome || null;
}

function resolveGuestNameFromReserva(
    reserva: ReservaHospedagem & {
        Usuario?: Usuario | null;
        ReservaSuite?: Array<
            ReservaSuite & {
                ReservaHospede?: ReservaHospede[];
            }
        >;
    }
): string | null {
    const nomeUsuario = formatUsuarioGuestName(reserva.Usuario ?? null);
    if (nomeUsuario) {
        return nomeUsuario;
    }

    for (const suite of reserva.ReservaSuite ?? []) {
        const nome = titularGuestName(suite.ReservaHospede ?? []);
        if (nome) {
            return nome;
        }
    }

    return null;
}

function formatDateValue(value: Date | string | null | undefined): string | null {
    if (!value) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }
    return date.toISOString();
}

export async function enrichOutboundFailedReservations(
    drafts: OutboundFailureDraft[]
): Promise<OutboundFailedReservationDetail[]> {
    if (!drafts.length) {
        return [];
    }

    const ids = [...new Set(drafts.map((draft) => draft.idReservaHospedagem))];
    const reservas = await ReservaHospedagem.findAll({
        where: { id: { [Op.in]: ids } },
        attributes: ['id', 'checkin', 'checkout', 'idExterno', 'idUsuario'],
        include: [
            {
                model: Usuario,
                attributes: ['nomeCompleto', 'sobreNome'],
                required: false,
            },
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                attributes: ['id'],
                required: false,
                include: [
                    {
                        model: ReservaHospede,
                        as: 'ReservaHospede',
                        attributes: ['nome'],
                        required: false,
                    },
                ],
            },
        ],
    });

    const reservaById = new Map(reservas.map((reserva) => [reserva.id, reserva]));

    return drafts.map((draft) => {
        const reserva = reservaById.get(draft.idReservaHospedagem);
        const hospedinReservationId =
            String(
                draft.hospedinReservationId ||
                    reserva?.idExterno ||
                    ''
            ).trim() || null;

        return {
            idReservaHospedagem: draft.idReservaHospedagem,
            idOutboundState: draft.idOutboundState,
            hospedinReservationId,
            hospedinIdExterno: reserva?.idExterno
                ? String(reserva.idExterno)
                : null,
            nomeHospede: reserva ? resolveGuestNameFromReserva(reserva) : null,
            checkin: reserva ? formatDateValue(reserva.checkin) : null,
            checkout: reserva ? formatDateValue(reserva.checkout) : null,
            operacao: draft.operacao,
            outcome: draft.outcome,
            mensagemErro: draft.mensagemErro ?? null,
            errorCode: draft.errorCode ?? null,
            httpStatus: resolveOutboundHttpStatus({
                httpStatus: draft.httpStatus,
                errorCode: draft.errorCode,
            }),
            correlationId: draft.correlationId,
        };
    });
}
