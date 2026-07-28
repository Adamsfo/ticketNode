/**
 * Normalização de status Hospedin (amostras reais account 69532):
 * reservation | check_in | canceled | pre_reservation | waitlist
 */

export function normalizeHospedinStatus(status: unknown): string {
    return String(status || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
}

/** Cancelamento Hospedin (API usa "canceled", 1 L). */
export function isHospedinCancelledStatus(status: unknown): boolean {
    const s = normalizeHospedinStatus(status);
    return (
        s === 'canceled' ||
        s === 'cancelled' ||
        s === 'no_show' ||
        s === 'noshow' ||
        s === 'void' ||
        s === 'deleted'
    );
}

/** Status operacionais elegíveis a CREATE/UPDATE nesta fase. */
export function isHospedinSyncableActiveStatus(status: unknown): boolean {
    const s = normalizeHospedinStatus(status);
    if (!s) return false;
    if (isHospedinCancelledStatus(s)) return false;
    // waitlist / pre_reservation: ainda não confirmadas — ignorar sync de domínio
    if (s === 'waitlist' || s === 'pre_reservation' || s === 'pre-reservation') {
        return false;
    }
    return true;
}
