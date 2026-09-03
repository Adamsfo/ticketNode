import { isOutboundClaimableStatus } from './hospedinOutboundClaimable';

/**
 * Dispara processamento outbound após nova pendência (import dinâmico evita ciclo).
 */
export async function notifyOutboundPendingIfClaimable(
    outboundStatus: string | null | undefined
): Promise<void> {
    if (!isOutboundClaimableStatus(outboundStatus)) {
        return;
    }
    const { markOutboundPendingAndDispatch } = await import(
        './HospedinOutboundDispatcher'
    );
    await markOutboundPendingAndDispatch();
}
