/**
 * Extrai valores financeiros Hospedin (centavos) → reais oficiais do Jango.
 */

import { asNumber } from '../mapper/mapperHelpers';

export type HospedinOfficialFinance = {
    valorTotal: number;
    valorPago: number;
    saldoPendente: number;
    /** Centavos originais (auditoria / hash). */
    totalCents: number;
    receivedCents: number;
    toReceiveCents: number;
};

function roundMoney(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

function centsToReais(cents: number | null | undefined): number | null {
    if (cents == null || !Number.isFinite(Number(cents))) return null;
    return roundMoney(Number(cents) / 100);
}

/**
 * Lê total_amount / total_received / total_to_receive do payload Hospedin.
 * Valores da API estão em centavos.
 */
export function extractHospedinOfficialFinance(
    payload: Record<string, unknown>
): HospedinOfficialFinance | null {
    const totalCents = asNumber(payload.total_amount);
    if (totalCents == null || !Number.isFinite(totalCents)) {
        return null;
    }

    const receivedCents = asNumber(payload.total_received) ?? 0;
    let toReceiveCents = asNumber(payload.total_to_receive);
    if (toReceiveCents == null) {
        toReceiveCents = Math.max(0, totalCents - receivedCents);
    }

    const valorTotal = centsToReais(totalCents);
    if (valorTotal == null) return null;

    const valorPago = centsToReais(receivedCents) ?? 0;
    let saldoPendente = centsToReais(toReceiveCents);
    if (saldoPendente == null) {
        saldoPendente = roundMoney(Math.max(0, valorTotal - valorPago));
    }

    return {
        valorTotal,
        valorPago,
        saldoPendente,
        totalCents,
        receivedCents,
        toReceiveCents,
    };
}
