import { HospedinOutboundStatus } from '../../../models/HospedinOutboundSyncState';

/** Status elegíveis para claim no runner outbound (fonte única). */
export const OUTBOUND_CLAIMABLE_STATUSES = [
    HospedinOutboundStatus.PENDING_CREATE,
    HospedinOutboundStatus.PENDING_UPDATE,
    HospedinOutboundStatus.PENDING_CANCEL,
    HospedinOutboundStatus.WAIT_RETRY,
] as const;

export type OutboundClaimableStatus =
    (typeof OUTBOUND_CLAIMABLE_STATUSES)[number];

export function isOutboundClaimableStatus(
    status: string | null | undefined
): boolean {
    const normalized = String(status || '').toUpperCase();
    return (OUTBOUND_CLAIMABLE_STATUSES as readonly string[]).includes(
        normalized
    );
}
