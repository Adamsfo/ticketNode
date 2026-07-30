/**
 * Política de comunicações automáticas da reserva de hospedagem.
 *
 * Origens internas (PMS Jango) → podem receber confirmação automática.
 * Qualquer outra origem (providers / OTA) → não dispara create automático.
 */

/** Origens criadas diretamente no PMS Jango (recepção, site, link cliente). */
export const INTERNAL_RESERVATION_ORIGINS = [
    'CLIENTE',
    'ATENDENTE',
    'SITE',
    'LINK_CLIENTE',
    'JANGO',
] as const;

export type InternalReservationOrigin =
    (typeof INTERNAL_RESERVATION_ORIGINS)[number];

function normalizeOrigem(
    origemReserva: string | null | undefined
): string {
    return String(origemReserva ?? '')
        .trim()
        .toUpperCase();
}

/**
 * True quando a reserva foi criada no Jango (não por provider externo).
 * Origem vazia/null trata-se como interna (legado online = CLIENTE).
 */
export function isInternalReservationOrigin(
    origemReserva: string | null | undefined
): boolean {
    const origem = normalizeOrigem(origemReserva);
    if (!origem) return true;
    return (INTERNAL_RESERVATION_ORIGINS as readonly string[]).includes(
        origem
    );
}

/**
 * Gate único para e-mail/WhatsApp de confirmação automática no CREATE/confirmação.
 * Providers (HOSPEDIN, BOOKING, AIRBNB, …) retornam false.
 *
 * Não se aplica a envio manual, reenvio, link de pagamento ou outras ações do operador.
 */
export function shouldSendAutomaticConfirmation(
    reservaOrOrigem:
        | { origemReserva?: string | null }
        | string
        | null
        | undefined
): boolean {
    if (
        reservaOrOrigem != null &&
        typeof reservaOrOrigem === 'object' &&
        'origemReserva' in reservaOrOrigem
    ) {
        return isInternalReservationOrigin(reservaOrOrigem.origemReserva);
    }
    return isInternalReservationOrigin(
        reservaOrOrigem as string | null | undefined
    );
}

/** Alias semântico pedido na especificação. */
export const ReservationNotificationPolicy = {
    shouldSendAutomaticConfirmation,
    isInternalReservationOrigin,
    INTERNAL_RESERVATION_ORIGINS,
} as const;
