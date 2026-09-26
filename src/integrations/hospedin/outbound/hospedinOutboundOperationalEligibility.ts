import { HospedinOutboundDesiredAction } from '../../../models/HospedinOutboundSyncState';
import {
    isCheckinAfterNow,
    isCheckoutAfterNow,
} from '../utils/operationalSyncWindow';

export type OutboundEligibilityInput = {
    desiredAction: string | null | undefined;
    outboundStatus?: string | null;
    checkin: Date | string | null | undefined;
    checkout?: Date | string | null | undefined;
    now?: Date;
};

/**
 * CREATE: só com check-in futuro (minuto).
 * UPDATE: check-in futuro OU checkout futuro (estadia ainda não encerrada).
 * CANCEL: sempre elegível (cancelamento pode ser necessário após check-in).
 */
export function isOutboundOperationEligible(
    input: OutboundEligibilityInput
): boolean {
    const now = input.now ?? new Date();
    const action = String(
        input.desiredAction ||
            inferActionFromStatus(input.outboundStatus) ||
            ''
    ).toUpperCase();

    if (action === HospedinOutboundDesiredAction.CANCEL) {
        return true;
    }
    if (
        action === HospedinOutboundDesiredAction.UPDATE ||
        String(input.outboundStatus || '').toUpperCase() === 'PENDING_UPDATE'
    ) {
        return (
            isCheckinAfterNow(input.checkin, now) ||
            isCheckoutAfterNow(input.checkout, now)
        );
    }
    return isCheckinAfterNow(input.checkin, now);
}

function inferActionFromStatus(
    status: string | null | undefined
): string | null {
    const s = String(status || '').toUpperCase();
    if (s === 'PENDING_CANCEL') return HospedinOutboundDesiredAction.CANCEL;
    if (s === 'PENDING_UPDATE') return HospedinOutboundDesiredAction.UPDATE;
    if (s === 'PENDING_CREATE') return HospedinOutboundDesiredAction.CREATE;
    return null;
}
