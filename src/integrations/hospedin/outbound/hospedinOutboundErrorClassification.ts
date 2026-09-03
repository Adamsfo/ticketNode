import { HospedinApiError } from '../types/errors';

export type OutboundErrorDisposition = {
    retryable: boolean;
    errorCode: string;
};

export function classifyOutboundHttpError(error: unknown): OutboundErrorDisposition {
    if (error instanceof HospedinApiError) {
        const status = Number(error.status) || 0;

        if (status === 401 || status === 403) {
            return { retryable: true, errorCode: 'AUTH_ERROR' };
        }
        if (status === 429) {
            return { retryable: true, errorCode: 'RATE_LIMITED' };
        }
        if (status >= 500) {
            return { retryable: true, errorCode: 'HTTP_5XX' };
        }
        if (status === 0) {
            return { retryable: true, errorCode: 'NETWORK_ERROR' };
        }
        if (status === 422) {
            return { retryable: false, errorCode: 'VALIDATION_ERROR' };
        }
        if (status === 404) {
            return { retryable: false, errorCode: 'NOT_FOUND' };
        }
        if (status === 409) {
            return { retryable: false, errorCode: 'HTTP_409' };
        }
        if (status >= 400 && status < 500) {
            return { retryable: false, errorCode: `HTTP_${status}` };
        }
    }

    const message = error instanceof Error ? error.message : String(error);
    if (/timeout|ECONNRESET|ENOTFOUND|network/i.test(message)) {
        return { retryable: true, errorCode: 'NETWORK_ERROR' };
    }

    return { retryable: false, errorCode: 'UNKNOWN_ERROR' };
}
