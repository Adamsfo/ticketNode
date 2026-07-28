import axios, { AxiosInstance, AxiosRequestConfig, Method } from 'axios';
import { getHospedinConfig } from '../constants/config';
import { HospedinLogger } from '../logger/HospedinLogger';
import { HospedinApiError } from '../types/errors';
import type { HospedinListParams, HospedinPaginatedResponse } from '../types';
import { maskBearer, maskSensitiveDeep } from '../utils/maskSensitive';

export type HospedinRequestOptions = {
    /** Se false, não envia Bearer (ex.: login). Default true. */
    auth?: boolean;
    /** Se false, não emite logs request:start/end. Default true. */
    log?: boolean;
    /** Desliga retry (rede/5xx). Default true. */
    retry?: boolean;
    /** Desliga renovação de token em 401. Default true. */
    renewOn401?: boolean;
    params?: Record<string, string | number | boolean | undefined | null>;
    data?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
    /** Uso interno: já tentou renovar token. */
    _authRetried?: boolean;
};

export type HospedinRequestMetaResult<T = unknown> = {
    success: boolean;
    method: string;
    endpoint: string;
    url: string;
    status: number;
    durationMs: number;
    data?: T;
    errorMessage?: string;
    requestBody?: unknown;
};

type TokenRenewer = () => Promise<void>;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Único cliente HTTP da integração Hospedin.
 * Responsável por: auth header, retry, renovação 401, paginação, erro e logs.
 * Nenhum outro arquivo deve usar axios/fetch para a Hospedin.
 */
export class HospedinApiClient {
    private readonly http: AxiosInstance;
    private memoryToken: string | null = null;
    private memoryAccountId: string | null = null;
    private tokenRenewer: TokenRenewer | null = null;

    constructor() {
        const cfg = getHospedinConfig();
        this.http = axios.create({
            baseURL: cfg.apiUrl,
            timeout: cfg.timeoutMs,
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
        });

        if (cfg.token) {
            this.memoryToken = cfg.token;
        }
    }

    setTokenRenewer(renewer: TokenRenewer | null): void {
        this.tokenRenewer = renewer;
    }

    setToken(token: string | null): void {
        this.memoryToken = token?.trim() || null;
    }

    getToken(): string | null {
        return this.memoryToken;
    }

    setAccountId(accountId: string | null): void {
        this.memoryAccountId = accountId?.trim() || null;
    }

    getAccountId(): string | null {
        return this.memoryAccountId;
    }

    async get<T = unknown>(
        path: string,
        options?: Omit<HospedinRequestOptions, 'data'>
    ): Promise<T> {
        return this.request<T>('GET', path, options);
    }

    async post<T = unknown>(
        path: string,
        data?: unknown,
        options?: Omit<HospedinRequestOptions, 'data'>
    ): Promise<T> {
        return this.request<T>('POST', path, { ...options, data });
    }

    async put<T = unknown>(
        path: string,
        data?: unknown,
        options?: Omit<HospedinRequestOptions, 'data'>
    ): Promise<T> {
        return this.request<T>('PUT', path, { ...options, data });
    }

    async patch<T = unknown>(
        path: string,
        data?: unknown,
        options?: Omit<HospedinRequestOptions, 'data'>
    ): Promise<T> {
        return this.request<T>('PATCH', path, { ...options, data });
    }

    async delete<T = unknown>(
        path: string,
        options?: Omit<HospedinRequestOptions, 'data'>
    ): Promise<T> {
        return this.request<T>('DELETE', path, options);
    }

    /**
     * Percorre todas as páginas `{ pagination, data }` da API.
     */
    async getAllPages<T = unknown>(
        path: string,
        options?: Omit<HospedinRequestOptions, 'data'> & {
            pageSize?: number;
            maxPages?: number;
            extraParams?: HospedinListParams;
        }
    ): Promise<T[]> {
        const cfg = getHospedinConfig();
        const pageSize = options?.pageSize ?? cfg.pageSize;
        const maxPages = options?.maxPages ?? cfg.maxPages;
        const all: T[] = [];
        let page = 1;

        while (page <= maxPages) {
            const response = await this.get<HospedinPaginatedResponse<T>>(path, {
                ...options,
                params: {
                    ...(options?.extraParams || {}),
                    ...(options?.params || {}),
                    page,
                    limit: pageSize,
                },
            });

            const chunk = Array.isArray(response?.data) ? response.data : [];
            all.push(...chunk);

            const last = response?.pagination?.last;
            const count = response?.pagination?.count;

            if (chunk.length === 0) break;
            if (typeof last === 'number' && page >= last) break;
            if (typeof count === 'number' && all.length >= count) break;
            if (chunk.length < pageSize) break;

            page += 1;
        }

        return all;
    }

    async requestMeta<T = unknown>(
        method: Method,
        path: string,
        options: HospedinRequestOptions = {}
    ): Promise<HospedinRequestMetaResult<T>> {
        const cfg = getHospedinConfig();
        const allowRetry = options.retry !== false;
        const maxRetries = allowRetry ? cfg.maxRetries : 0;

        let last: HospedinRequestMetaResult<T> | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            last = await this.requestMetaOnce<T>(method, path, options);

            if (last.success) return last;

            const retriable = last.status === 0 || last.status >= 500;
            if (!retriable || attempt >= maxRetries) break;

            const delay = cfg.retryDelayMs * (attempt + 1);
            HospedinLogger.warn('request:retry', {
                method: last.method,
                endpoint: last.endpoint,
                status: last.status,
                attempt: attempt + 1,
                delayMs: delay,
            });
            if (delay > 0) await sleep(delay);
        }

        return last!;
    }

    async request<T = unknown>(
        method: Method,
        path: string,
        options: HospedinRequestOptions = {}
    ): Promise<T> {
        let result = await this.requestMeta<T>(method, path, options);

        const canRenew =
            options.renewOn401 !== false &&
            options.auth !== false &&
            !options._authRetried &&
            result.status === 401 &&
            this.tokenRenewer;

        if (canRenew) {
            HospedinLogger.auth('401 — tentando renovar token (re-login)');
            try {
                await this.tokenRenewer!();
                result = await this.requestMeta<T>(method, path, {
                    ...options,
                    _authRetried: true,
                    renewOn401: false,
                });
            } catch (err: any) {
                HospedinLogger.error('falha ao renovar token', {
                    message: err?.message,
                });
            }
        }

        if (result.success) {
            return result.data as T;
        }

        throw new HospedinApiError(
            result.errorMessage || `Hospedin API HTTP ${result.status}`,
            result.status || 502,
            result.data ?? null
        );
    }

    private async requestMetaOnce<T = unknown>(
        method: Method,
        path: string,
        options: HospedinRequestOptions = {}
    ): Promise<HospedinRequestMetaResult<T>> {
        const cfg = getHospedinConfig();
        const useAuth = options.auth !== false;
        const headers: Record<string, string> = { ...(options.headers || {}) };
        const endpoint = path.startsWith('/') ? path : `/${path}`;
        const methodLabel = String(method).toUpperCase();
        const url = `${cfg.apiUrl}${endpoint}`;

        if (useAuth) {
            const token = this.getToken();
            if (!token) {
                return {
                    success: false,
                    method: methodLabel,
                    endpoint,
                    url,
                    status: 401,
                    durationMs: 0,
                    errorMessage:
                        'Hospedin: token ausente. Faça login ou configure HOSPEDIN_TOKEN.',
                    requestBody:
                        options.data !== undefined
                            ? (maskSensitiveDeep(options.data) as object)
                            : undefined,
                };
            }
            headers.Authorization = `Bearer ${token}`;
        }

        const cleanParams: Record<string, string | number | boolean> = {};
        if (options.params) {
            for (const [k, v] of Object.entries(options.params)) {
                if (v === undefined || v === null || v === '') continue;
                cleanParams[k] = v;
            }
        }

        const config: AxiosRequestConfig = {
            method,
            url: endpoint,
            headers,
            params: Object.keys(cleanParams).length ? cleanParams : undefined,
            data: options.data,
            timeout: options.timeoutMs ?? cfg.timeoutMs,
            validateStatus: () => true,
        };

        const shouldLog = options.log !== false;
        const maskedBody =
            options.data !== undefined
                ? maskSensitiveDeep(options.data)
                : undefined;

        if (shouldLog) {
            HospedinLogger.requestStart({
                method: methodLabel,
                endpoint,
                params: Object.keys(cleanParams).length ? cleanParams : null,
            });
            if (HospedinLogger.isDebugEnabled() && maskedBody !== undefined) {
                HospedinLogger.debug('request:body', {
                    method: methodLabel,
                    endpoint,
                    body: maskedBody,
                    authorization: useAuth
                        ? `Bearer ${maskBearer(this.getToken())}`
                        : null,
                });
            }
        }

        const started = Date.now();
        let response;

        try {
            response = await this.http.request(config);
        } catch (err: any) {
            const durationMs = Date.now() - started;
            const message = err?.message || 'erro desconhecido';
            if (shouldLog) {
                HospedinLogger.requestEnd({
                    method: methodLabel,
                    endpoint,
                    status: 0,
                    durationMs,
                    errorMessage: message,
                });
            }
            return {
                success: false,
                method: methodLabel,
                endpoint,
                url,
                status: 0,
                durationMs,
                errorMessage: `Hospedin: falha de rede (${message}).`,
                requestBody: maskedBody as object | undefined,
            };
        }

        const durationMs = Date.now() - started;
        const ok = response.status >= 200 && response.status < 300;

        if (ok) {
            if (shouldLog) {
                HospedinLogger.requestEnd({
                    method: methodLabel,
                    endpoint,
                    status: response.status,
                    durationMs,
                    responseBody: response.data,
                });
            }
            return {
                success: true,
                method: methodLabel,
                endpoint,
                url,
                status: response.status,
                durationMs,
                data: response.data as T,
                requestBody: maskedBody as object | undefined,
            };
        }

        const msg =
            (response.data &&
                (response.data.message ||
                    response.data.error ||
                    response.data.title ||
                    (Array.isArray(response.data.errors)
                        ? response.data.errors.join(', ')
                        : null))) ||
            `Hospedin API HTTP ${response.status}`;

        if (shouldLog) {
            HospedinLogger.requestEnd({
                method: methodLabel,
                endpoint,
                status: response.status,
                durationMs,
                errorMessage: String(msg),
                responseBody: response.data,
            });
        }

        return {
            success: false,
            method: methodLabel,
            endpoint,
            url,
            status: response.status,
            durationMs,
            errorMessage: String(msg),
            data: response.data as T,
            requestBody: maskedBody as object | undefined,
        };
    }
}

export const hospedinApiClient = new HospedinApiClient();
