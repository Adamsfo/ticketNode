/** Link externo /reserva/:token (recepção → enviar para cliente). */
export const MINUTOS_EXPIRACAO_LINK_PAGAMENTO = 30;

/** Expiração legada do checkout online (CLIENTE/SITE) quando expiraEm está nulo. */
export const MINUTOS_EXPIRACAO_RESERVA_ONLINE = 15;

export function calcularExpiraEmLinkPagamento(desde: Date = new Date()): Date {
    return new Date(
        desde.getTime() + MINUTOS_EXPIRACAO_LINK_PAGAMENTO * 60 * 1000
    );
}

/** Prazo explícito para reserva online (CLIENTE) aguardando pagamento. */
export function calcularExpiraEmReservaOnline(desde: Date = new Date()): Date {
    return new Date(
        desde.getTime() + MINUTOS_EXPIRACAO_RESERVA_ONLINE * 60 * 1000
    );
}
