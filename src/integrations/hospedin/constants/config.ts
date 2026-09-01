/**
 * Configuração centralizada da integração Hospedin (somente env).
 * Único ponto de leitura de account_id, token, timeout, paginação e retry.
 */

export const HOSPEDIN_DEFAULT_API_URL = 'https://pms-api.hospedin.com';

export type HospedinConfig = {
    apiUrl: string;
    email: string | null;
    password: string | null;
    /** Token estático opcional (seed em memória; pula login inicial se informado). */
    token: string | null;
    /** Slug ou ID numérico (ex.: pousada-jango | 69532). */
    accountId: string | null;
    /** Timeout HTTP em ms. */
    timeoutMs: number;
    /** Itens por página nas listagens. */
    pageSize: number;
    /** Limite de páginas ao percorrer listas. */
    maxPages: number;
    /** Tentativas extras em falha de rede / 5xx. */
    maxRetries: number;
    /** Delay base entre retries (ms). */
    retryDelayMs: number;
    /** Quando true, HospedinLogger inclui corpos. */
    debug: boolean;
    /**
     * Usuario.id técnico usado como idUsuario/cliente nas reservas sync.
     * Obrigatório para CREATE via ReservationCreationService.
     */
    syncUserId: number | null;
    /**
     * @deprecated Incremental usa check_in >= (hoje - 7 dias).
     * Mantido por compatibilidade de env; não afeta o filtro operacional.
     */
    historicalSyncDays: number;
};

function envFlag(value: string | undefined): boolean {
    const v = (value || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function envInt(
    value: string | undefined,
    fallback: number,
    min = 1
): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min) return fallback;
    return Math.floor(n);
}

export function getHospedinConfig(): HospedinConfig {
    const apiUrl = (
        process.env.HOSPEDIN_API_URL || HOSPEDIN_DEFAULT_API_URL
    ).replace(/\/+$/, '');

    return {
        apiUrl,
        email: process.env.HOSPEDIN_EMAIL?.trim() || null,
        password: process.env.HOSPEDIN_PASSWORD || null,
        token: process.env.HOSPEDIN_TOKEN?.trim() || null,
        accountId: process.env.HOSPEDIN_ACCOUNT_ID?.trim() || null,
        timeoutMs: envInt(process.env.HOSPEDIN_TIMEOUT_MS, 30_000, 1000),
        pageSize: envInt(process.env.HOSPEDIN_PAGE_SIZE, 100, 1),
        maxPages: envInt(process.env.HOSPEDIN_MAX_PAGES, 500, 1),
        maxRetries: envInt(process.env.HOSPEDIN_MAX_RETRIES, 2, 0),
        retryDelayMs: envInt(process.env.HOSPEDIN_RETRY_DELAY_MS, 500, 0),
        debug: envFlag(process.env.HOSPEDIN_DEBUG),
        syncUserId: (() => {
            const n = Number(process.env.HOSPEDIN_SYNC_USER_ID);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        })(),
        historicalSyncDays: envInt(
            process.env.HOSPEDIN_HISTORICAL_SYNC_DAYS,
            30,
            0
        ),
    };
}
