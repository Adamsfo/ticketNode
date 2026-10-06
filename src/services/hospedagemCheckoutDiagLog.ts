/**
 * Instrumentação temporária do checkout link hospedagem (50% + taxas).
 * Ativar: HOSPEDAGEM_CHECKOUT_DIAG=1 e LOG_LEVEL=INFO (ou DEBUG).
 * Remover após fechar causa da regressão.
 */

import { logger } from '../utils/logger';

const log = logger.child('HOSPEDAGEM_CHECKOUT_DIAG');

function diagEnabled(): boolean {
    const v = String(process.env.HOSPEDAGEM_CHECKOUT_DIAG ?? '')
        .trim()
        .toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export type HospedagemCheckoutDiagTransacaoSnapshot = {
    valorTotal?: number;
    taxaServico?: number;
    preco?: number;
};

export function logHospedagemCheckoutDiag(
    etapa: string,
    payload: Record<string, unknown>
): void {
    if (!diagEnabled()) {
        return;
    }
    log.info(etapa, payload);
}

export function logHospedagemCheckoutDiagTransacaoWrite(params: {
    origem: string;
    operacao: 'create' | 'update';
    idTransacao?: number | null;
    idReserva?: number | null;
    valores: HospedagemCheckoutDiagTransacaoSnapshot;
    extra?: Record<string, unknown>;
}): void {
    if (!diagEnabled()) {
        return;
    }
    log.info('Transacao.write', {
        ...params,
        sequencia: `${params.operacao}:${params.origem}`,
    });
}
