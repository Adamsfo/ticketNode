/**
 * Client HTTP técnico do SuperTEF.
 * Sem regras de negócio de ingressos ou hospedagem — apenas comunicação com a API.
 * PagamentoPDV permanece intacto (continua com suas chamadas próprias).
 */
import axios, { AxiosError } from 'axios';
import { randomUUID } from 'crypto';

const SUPERTEF_BASE = 'https://api.supertef.com.br/api/pagamentos';
const SuperTefBearerToken = process.env.SUPERTEF_BEARER_TOKEN || '';

export type SuperTefTransactionType = 1 | 2 | 3; // 1=débito, 2=crédito, 3=PIX

export type SuperTefCriarPagamentoInput = {
    clienteChave: string;
    posId: number | string;
    transactionType: SuperTefTransactionType;
    amount: number;
    /** Identificador próprio do chamador (order_id no SuperTEF). */
    orderId: string;
    description: string;
    installmentCount?: number;
    installmentType?: number;
};

export type SuperTefCriarPagamentoResult = {
    /** ID externo retornado pelo SuperTEF (quando presente). */
    idExterno: string;
    orderId: string;
    raw: Record<string, unknown>;
};

export type SuperTefConsultaResult = {
    idExterno?: string;
    payment_status?: number;
    payment_message?: string;
    created_at?: string;
    payment_data?: Record<string, unknown>;
    raw: Record<string, unknown>;
};

function authHeaders() {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SuperTefBearerToken}`,
    };
}

function toErrorMessage(error: unknown, fallback: string): string {
    const ax = error as AxiosError<{
        message?: string;
        error?: string;
        detail?: string;
    }>;
    return (
        ax?.response?.data?.message ||
        ax?.response?.data?.error ||
        ax?.response?.data?.detail ||
        (error instanceof Error ? error.message : null) ||
        fallback
    );
}

/** Extrai ID externo do SuperTEF de formatos conhecidos da API. */
export function extrairIdExternoSuperTef(raw: unknown): string {
    if (raw == null) return '';
    if (typeof raw === 'string' || typeof raw === 'number') {
        const s = String(raw).trim();
        return s && s !== 'undefined' && s !== 'null' ? s : '';
    }
    if (typeof raw !== 'object') return '';

    const obj = raw as Record<string, unknown>;
    const nested = [
        obj.payment_uniqueid,
        obj.paymentUniqueId,
        obj.payment_unique_id,
        obj.uniqueid,
        obj.unique_id,
        obj.id,
        (obj.data as Record<string, unknown> | undefined)?.payment_uniqueid,
        (obj.data as Record<string, unknown> | undefined)?.paymentUniqueId,
        (obj.data as Record<string, unknown> | undefined)?.id,
        (obj.result as Record<string, unknown> | undefined)?.payment_uniqueid,
        (obj.result as Record<string, unknown> | undefined)?.id,
    ];

    for (const candidate of nested) {
        const found = extrairIdExternoSuperTef(candidate);
        if (found) return found;
    }
    return '';
}

export function novoUuidOperacaoHospedagem(): string {
    return randomUUID();
}

/** Inicia pagamento no pinpad SuperTEF. */
export async function superTefCriarPagamento(
    input: SuperTefCriarPagamentoInput
): Promise<SuperTefCriarPagamentoResult> {
    if (!SuperTefBearerToken) {
        throw new Error('SUPERTEF_BEARER_TOKEN não configurado.');
    }

    const payload = {
        cliente_chave: input.clienteChave,
        pos_id: input.posId,
        transaction_type: input.transactionType,
        installment_count: input.installmentCount ?? 1,
        amount: Number(input.amount),
        order_id: String(input.orderId),
        description: input.description,
        installment_type: input.installmentType ?? 1,
    };

    try {
        const response = await axios({
            method: 'post',
            url: SUPERTEF_BASE,
            headers: authHeaders(),
            data: JSON.stringify(payload),
        });
        const raw = (response.data || {}) as Record<string, unknown>;
        const idExterno = extrairIdExternoSuperTef(raw);
        return {
            idExterno,
            orderId: String(input.orderId),
            raw,
        };
    } catch (error) {
        throw new Error(toErrorMessage(error, 'Erro ao iniciar pagamento SuperTEF.'));
    }
}

/** Consulta status do pagamento no SuperTEF pelo ID externo. */
export async function superTefConsultarPagamento(
    idExterno: string
): Promise<SuperTefConsultaResult> {
    if (!SuperTefBearerToken) {
        throw new Error('SUPERTEF_BEARER_TOKEN não configurado.');
    }

    try {
        const response = await axios({
            method: 'get',
            url: `${SUPERTEF_BASE}/by-uniqueid/${idExterno}?payment_uniqueid`,
            headers: authHeaders(),
        });
        const raw = (response.data || {}) as Record<string, unknown>;
        return {
            idExterno: extrairIdExternoSuperTef(raw) || idExterno,
            payment_status: Number(raw.payment_status),
            payment_message: String(raw.payment_message ?? ''),
            created_at: raw.created_at ? String(raw.created_at) : undefined,
            payment_data:
                (raw.payment_data as Record<string, unknown>) || undefined,
            raw,
        };
    } catch (error) {
        throw new Error(
            toErrorMessage(error, 'Erro ao consultar pagamento SuperTEF.')
        );
    }
}

/** Cancela operação no pinpad SuperTEF. */
export async function superTefCancelarPagamento(
    idExterno: string
): Promise<Record<string, unknown>> {
    if (!SuperTefBearerToken) {
        throw new Error('SUPERTEF_BEARER_TOKEN não configurado.');
    }

    try {
        const response = await axios({
            method: 'put',
            url: `${SUPERTEF_BASE}/cancelar/${idExterno}`,
            headers: authHeaders(),
        });
        return (response.data || {}) as Record<string, unknown>;
    } catch (error) {
        throw new Error(
            toErrorMessage(error, 'Erro ao cancelar pagamento SuperTEF.')
        );
    }
}

/** Status SuperTEF. */
export const SUPERTEF_STATUS = {
    SOLICITADO: 1,
    APROVADO: 4,
    CANCELADO_ERRO: 5,
} as const;
