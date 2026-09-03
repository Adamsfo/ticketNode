import {
    HospedinOutboundDesiredAction,
    HospedinOutboundStatus,
} from '../../../models/HospedinOutboundSyncState';
import { StatusReservaHospedagem } from '../../../models/ReservaHospedagem';

export type CreateFinalizeSnapshot = {
    jangoStatus?: string | null;
    desiredAction?: string | null;
    outboundStatus?: string | null;
};

/** CREATE pós-POST deve enfileirar CANCEL em vez de SYNCED. */
export function shouldDeferCreateToPendingCancel(
    snapshot: CreateFinalizeSnapshot
): boolean {
    if (snapshot.jangoStatus === StatusReservaHospedagem.Cancelada) {
        return true;
    }

    const action = String(snapshot.desiredAction || '').toUpperCase();
    if (action === HospedinOutboundDesiredAction.CANCEL) {
        return true;
    }

    const status = String(snapshot.outboundStatus || '');
    if (status === HospedinOutboundStatus.PENDING_CANCEL) {
        return true;
    }

    return false;
}

/** Compare-and-set: só SYNCED se ainda PROCESSING com intenção CREATE/UPDATE. */
export function canMarkSyncedAfterCreate(
    snapshot: CreateFinalizeSnapshot
): boolean {
    if (shouldDeferCreateToPendingCancel(snapshot)) {
        return false;
    }

    return (
        String(snapshot.outboundStatus || '') ===
            HospedinOutboundStatus.PROCESSING &&
        String(snapshot.desiredAction || '').toUpperCase() !==
            HospedinOutboundDesiredAction.CANCEL
    );
}

export type CreateFinalizeDecision = 'pending_cancel' | 'mark_synced';

export function resolveCreateFinalizeDecision(
    snapshot: CreateFinalizeSnapshot
): CreateFinalizeDecision {
    if (shouldDeferCreateToPendingCancel(snapshot)) {
        return 'pending_cancel';
    }
    if (canMarkSyncedAfterCreate(snapshot)) {
        return 'mark_synced';
    }
    return 'pending_cancel';
}
