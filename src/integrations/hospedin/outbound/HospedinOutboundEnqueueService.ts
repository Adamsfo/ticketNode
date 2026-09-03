import { Evento } from '../../../models/Evento';
import { ReservaHospedagem, StatusReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaHospede } from '../../../models/ReservaHospede';
import { ReservaSuite } from '../../../models/ReservaSuite';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundStatus,
    HospedinOutboundSyncState,
} from '../../../models/HospedinOutboundSyncState';
import { PlaceSuiteMappingStatus } from '../../../models/HospedinPlaceSuiteMap';
import { hospedinPlaceSuiteMapService } from '../services/HospedinPlaceSuiteMapService';
import {
    buildSnapshotFromReserva,
    hashOutboundPayload,
    snapshotToHashInput,
} from './HospedinOutboundSnapshot';
import { hospedinOutboundStateService } from './HospedinOutboundStateService';
import { notifyOutboundPendingIfClaimable } from './hospedinOutboundDispatchTrigger';

/**
 * Validação de status da reserva para CREATE outbound.
 * NÃO aplicada no enqueue — a reserva pode entrar na fila em qualquer status (ex.: AguardandoPagamento).
 * Implementar no runner/scheduler outbound (HospedinOutboundRunner.runCycle) antes do POST Hospedin.
 */
export const OUTBOUND_CREATE_ALLOWED_STATUSES_NOTE =
    'Scheduler outbound: validar status Jango permitido para CREATE antes do POST (ex.: Confirmada+).';

export const HospedinOutboundPreconditionCode = {
    SUITE_LINE_MISSING: 'SUITE_LINE_MISSING',
    GUEST_NAME_MISSING: 'GUEST_NAME_MISSING',
    SUITE_UNMAPPED: 'SUITE_UNMAPPED',
} as const;

type OutboundPreconditionResult = {
    ok: boolean;
    errorCode: string | null;
    lastError: string | null;
};

/** Elegibilidade de origem — único filtro que impede entrada na fila. */
function isOriginEligibleForOutbound(
    hospedagem: ReservaHospedagem & {
        origemReserva?: string | null;
        Evento?: { tipo?: string | null } | null;
    }
): boolean {
    const origem = String(hospedagem.origemReserva || '').toUpperCase();
    if (origem === 'HOSPEDIN') {
        return false;
    }

    const tipoEvento = String(hospedagem.Evento?.tipo || '').trim();
    if (tipoEvento && tipoEvento !== 'Pousada') {
        return false;
    }

    return true;
}

/**
 * Pré-condições para envio efetivo — ausência gera BLOCKED, não descarta a fila.
 * Reavaliadas a cada markDirty; recuperação automática quando resolvido.
 */
async function evaluateOutboundPreconditions(
    hospedagem: ReservaHospedagem & {
        ReservaSuite?: Array<
            ReservaSuite & {
                ReservaHospede?: ReservaHospede[];
            }
        >;
    }
): Promise<OutboundPreconditionResult> {
    const suites = hospedagem.ReservaSuite ?? [];
    const linha = suites[0];
    if (!linha) {
        return {
            ok: false,
            errorCode: HospedinOutboundPreconditionCode.SUITE_LINE_MISSING,
            lastError: 'Reserva sem linha de suíte para outbound.',
        };
    }

    const hospedes = (linha.ReservaHospede ?? []).filter((h) =>
        String(h.nome || '').trim()
    );
    if (!hospedes.length) {
        return {
            ok: false,
            errorCode: HospedinOutboundPreconditionCode.GUEST_NAME_MISSING,
            lastError: 'Reserva sem hóspede titular com nome para outbound.',
        };
    }

    const idEventoSuite = Number(linha.idEventoSuite);
    if (!Number.isFinite(idEventoSuite) || idEventoSuite <= 0) {
        return {
            ok: false,
            errorCode: HospedinOutboundPreconditionCode.SUITE_UNMAPPED,
            lastError: 'Suíte da reserva inválida para mapeamento Hospedin.',
        };
    }

    const map = await hospedinPlaceSuiteMapService.findByEventoSuiteId(
        idEventoSuite
    );
    if (
        !map ||
        !map.ativo ||
        String(map.mapping_status || '').toUpperCase() !==
            PlaceSuiteMappingStatus.LINKED
    ) {
        return {
            ok: false,
            errorCode: HospedinOutboundPreconditionCode.SUITE_UNMAPPED,
            lastError: `Suíte id=${idEventoSuite} sem mapeamento Hospedin ativo (LINKED).`,
        };
    }

    return { ok: true, errorCode: null, lastError: null };
}

function resolveNeverSent(
    hospedagem: ReservaHospedagem,
    existing: HospedinOutboundSyncState | null
): boolean {
    const idExterno = String(hospedagem.idExterno || '').trim();
    const hospedinId = String(existing?.hospedin_reservation_id || '').trim();
    return !idExterno && !hospedinId;
}

function hasHospedinLink(
    hospedagem: ReservaHospedagem,
    existing: HospedinOutboundSyncState | null
): boolean {
    return !resolveNeverSent(hospedagem, existing);
}

function shouldSkipMarkDirty(
    hospedagem: ReservaHospedagem,
    existing: HospedinOutboundSyncState | null
): boolean {
    if (hospedagem.status === StatusReservaHospedagem.Cancelada) {
        return true;
    }
    if (!existing) {
        return false;
    }
    if (existing.outbound_status === HospedinOutboundStatus.ABORTED) {
        return true;
    }
    const action = String(existing.desired_action || '').toUpperCase();
    if (action === HospedinOutboundDesiredAction.CANCEL) {
        const status = String(existing.outbound_status || '');
        if (
            status === HospedinOutboundStatus.PENDING_CANCEL ||
            status === HospedinOutboundStatus.SYNCED
        ) {
            return true;
        }
    }
    return false;
}

function resolveNextQueueState(input: {
    neverSent: boolean;
    existing: HospedinOutboundSyncState | null;
    preconditions: OutboundPreconditionResult;
}): {
    outbound_status: string;
    desired_action: string;
    last_error: string | null;
    error_code: string | null;
} {
    const { neverSent, existing, preconditions } = input;
    const desired_action = neverSent
        ? HospedinOutboundDesiredAction.CREATE
        : HospedinOutboundDesiredAction.UPDATE;

    if (
        existing?.outbound_status === HospedinOutboundStatus.PROCESSING
    ) {
        return {
            outbound_status: HospedinOutboundStatus.PROCESSING,
            desired_action: String(existing.desired_action || desired_action),
            last_error: existing.last_error,
            error_code: existing.error_code,
        };
    }

    if (!preconditions.ok) {
        return {
            outbound_status: HospedinOutboundStatus.BLOCKED,
            desired_action,
            last_error: preconditions.lastError,
            error_code: preconditions.errorCode,
        };
    }

    return {
        outbound_status: neverSent
            ? HospedinOutboundStatus.PENDING_CREATE
            : HospedinOutboundStatus.PENDING_UPDATE,
        desired_action,
        last_error: null,
        error_code: null,
    };
}

/**
 * Marca reserva Jango para sincronização outbound (fila assíncrona).
 * Persistência local apenas — sem HTTP Hospedin.
 * Deve ser aguardado (await) pelos pontos de escrita da reserva.
 */
export async function markDirty(idReservaHospedagem: number): Promise<void> {
    const id = Number(idReservaHospedagem);
    if (!Number.isFinite(id) || id <= 0) {
        return;
    }

    const hospedagem = (await ReservaHospedagem.findByPk(id, {
        include: [
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'tipo'],
                required: false,
            },
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                required: false,
                include: [
                    {
                        model: ReservaHospede,
                        as: 'ReservaHospede',
                        required: false,
                    },
                ],
            },
        ],
    })) as
        | (ReservaHospedagem & {
              origemReserva?: string | null;
              Evento?: { tipo?: string | null } | null;
              ReservaSuite?: Array<
                  ReservaSuite & {
                      ReservaHospede?: ReservaHospede[];
                  }
              >;
          })
        | null;

    if (!hospedagem) {
        return;
    }

    if (!isOriginEligibleForOutbound(hospedagem)) {
        return;
    }

    const now = new Date();
    const existing = await HospedinOutboundSyncState.findOne({
        where: { id_reserva_hospedagem: id },
    });

    if (shouldSkipMarkDirty(hospedagem, existing)) {
        return;
    }

    const snapshot = buildSnapshotFromReserva(hospedagem);
    const pendingHash = hashOutboundPayload(snapshotToHashInput(snapshot));
    const preconditions = await evaluateOutboundPreconditions(hospedagem);

    const neverSent = resolveNeverSent(hospedagem, existing);
    const nextState = resolveNextQueueState({
        neverSent,
        existing,
        preconditions,
    });
    const idExterno = String(hospedagem.idExterno || '').trim() || null;

    if (existing) {
        const hashUnchanged =
            existing.outbound_status === HospedinOutboundStatus.SYNCED &&
            Boolean(existing.payload_hash) &&
            pendingHash === existing.payload_hash;

        if (hashUnchanged) {
            return;
        }

        const clearErrors =
            nextState.outbound_status !== HospedinOutboundStatus.PROCESSING &&
            preconditions.ok;

        await existing.update({
            outbound_status: nextState.outbound_status,
            desired_action: nextState.desired_action,
            pending_payload_hash: pendingHash,
            hospedin_reservation_id:
                idExterno ?? existing.hospedin_reservation_id,
            dirty_at: now,
            updated_at: now,
            last_error: clearErrors ? null : nextState.last_error,
            error_code: clearErrors ? null : nextState.error_code,
        });
        await notifyOutboundPendingIfClaimable(nextState.outbound_status);
        return;
    }

    await HospedinOutboundSyncState.create({
        id_reserva_hospedagem: id,
        outbound_status: nextState.outbound_status,
        desired_action: nextState.desired_action,
        pending_payload_hash: pendingHash,
        hospedin_reservation_id: idExterno,
        dirty_at: now,
        last_error: nextState.last_error,
        error_code: nextState.error_code,
        created_at: now,
        updated_at: now,
    });
    await notifyOutboundPendingIfClaimable(nextState.outbound_status);
}

/**
 * Enfileira ou aborta cancelamento outbound após cancelamento efetivo no Jango.
 * Não usa markDirty — intenção explícita de CANCEL/ABORT.
 */
export async function markOutboundCancelled(
    idReservaHospedagem: number
): Promise<void> {
    const id = Number(idReservaHospedagem);
    if (!Number.isFinite(id) || id <= 0) {
        return;
    }

    const hospedagem = (await ReservaHospedagem.findByPk(id, {
        include: [
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'tipo'],
                required: false,
            },
        ],
    })) as
        | (ReservaHospedagem & {
              origemReserva?: string | null;
              Evento?: { tipo?: string | null } | null;
          })
        | null;

    if (!hospedagem) {
        return;
    }

    if (!isOriginEligibleForOutbound(hospedagem)) {
        return;
    }

    if (hospedagem.status !== StatusReservaHospedagem.Cancelada) {
        return;
    }

    const now = new Date();
    const existing = await HospedinOutboundSyncState.findOne({
        where: { id_reserva_hospedagem: id },
    });
    const linked = hasHospedinLink(hospedagem, existing);
    const idExterno = String(hospedagem.idExterno || '').trim() || null;

    if (!linked) {
        if (existing) {
            await hospedinOutboundStateService.markAborted(existing.id, {
                errorMessage:
                    'Reserva cancelada no Jango antes do CREATE outbound.',
                errorCode: 'CREATE_ABORTED',
            });
        } else {
            await HospedinOutboundSyncState.create({
                id_reserva_hospedagem: id,
                outbound_status: HospedinOutboundStatus.ABORTED,
                desired_action: HospedinOutboundDesiredAction.CANCEL,
                dirty_at: now,
                last_error:
                    'Reserva cancelada no Jango antes do CREATE outbound.',
                error_code: 'CREATE_ABORTED',
                created_at: now,
                updated_at: now,
            });
        }
        return;
    }

    if (existing) {
        await hospedinOutboundStateService.markPendingCancel(existing.id);
        if (idExterno && !existing.hospedin_reservation_id) {
            await existing.update({
                hospedin_reservation_id: idExterno,
                updated_at: now,
            });
        }
        return;
    }

    await HospedinOutboundSyncState.create({
        id_reserva_hospedagem: id,
        outbound_status: HospedinOutboundStatus.PENDING_CANCEL,
        desired_action: HospedinOutboundDesiredAction.CANCEL,
        hospedin_reservation_id: idExterno,
        dirty_at: now,
        created_at: now,
        updated_at: now,
    });
    await notifyOutboundPendingIfClaimable(
        HospedinOutboundStatus.PENDING_CANCEL
    );
}

export const hospedinOutboundEnqueueService = {
    markDirty,
    markOutboundCancelled,
};

/** Helpers expostos para testes unitários (sem DB). */
export const outboundEnqueueTestHelpers = {
    resolveNeverSent,
    hasHospedinLink,
    shouldSkipMarkDirty,
};
