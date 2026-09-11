/**
 * Finalização de sync outbound — detecta pending mais recente durante PROCESSING.
 */
export function shouldRequeueAfterAppliedSync(
    appliedPayloadHash: string,
    pendingPayloadHash: string | null | undefined
): boolean {
    const applied = String(appliedPayloadHash || '').trim();
    const pending = String(pendingPayloadHash || '').trim();
    if (!applied || !pending) {
        return false;
    }
    return pending !== applied;
}
