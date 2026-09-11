/**
 * Elegibilidade de origem outbound — regra única compartilhada (enqueue + SALE).
 */
export function isOriginEligibleForOutbound(hospedagem: {
    origemReserva?: string | null;
    Evento?: { tipo?: string | null } | null;
}): boolean {
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
