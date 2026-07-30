import { getHospedinConfig } from '../constants/config';
import type { HospedinAuthSession, HospedinPaginatedResponse } from '../types';
import { hospedinApiClient } from '../api/HospedinApiClient';
import { HospedinLogger } from '../logger/HospedinLogger';
import { hospedinAuthService } from './HospedinAuthService';
import { hospedinPlaceService } from './HospedinPlaceService';
import { hospedinReservationService } from './HospedinReservationService';

export type HospedinTestStepName =
    | 'Login'
    | 'Descoberta Account'
    | 'Places'
    | 'Place Types'
    | 'Reservations';

export type HospedinTestStep = {
    step: HospedinTestStepName;
    method: string | null;
    url: string | null;
    status: number | null;
    success: boolean;
    durationMs?: number;
    detail?: string;
    error?: string;
    requestBody?: unknown;
};

export type HospedinConnectivityTestResult = {
    ok: boolean;
    authenticated: boolean;
    accountId: string | null;
    accountSource: string | null;
    account: unknown;
    places: number;
    placeTypes: number;
    reservations: number;
    saleChannels: number;
    steps: HospedinTestStep[];
    failedAt: HospedinTestStepName | null;
};

function totalFromList<T>(
    response: HospedinPaginatedResponse<T> | null | undefined
): number {
    if (!response) return 0;
    if (typeof response.pagination?.count === 'number') {
        return response.pagination.count;
    }
    return Array.isArray(response.data) ? response.data.length : 0;
}

function logStep(step: HospedinTestStep): void {
    if (step.success) {
        HospedinLogger.debug(`test-step:ok:${step.step}`, {
            step: step.step,
            method: step.method,
            url: step.url,
            status: step.status,
            success: step.success,
            detail: step.detail,
        });
    } else {
        HospedinLogger.error(`test-step:fail:${step.step}`, {
            step: step.step,
            method: step.method,
            url: step.url,
            status: step.status,
            success: step.success,
            error: step.error,
            detail: step.detail,
        });
    }
}

/**
 * Teste de conectividade focado nos endpoints usados pelo Channel Manager.
 * Ignora my_account / companies / sale_channels (403 nesta conta).
 */
export async function runHospedinConnectivityTest(): Promise<HospedinConnectivityTestResult> {
    const cfg = getHospedinConfig();
    const steps: HospedinTestStep[] = [];
    const listParams = { page: 1, limit: 1 };

    const result: HospedinConnectivityTestResult = {
        ok: false,
        authenticated: false,
        accountId: null,
        accountSource: null,
        account: null,
        places: 0,
        placeTypes: 0,
        reservations: 0,
        saleChannels: 0,
        steps,
        failedAt: null,
    };

    const fail = (step: HospedinTestStepName) => {
        result.failedAt = step;
        result.ok = false;
        return result;
    };

    hospedinAuthService.logout();

    const email = (cfg.email || '').trim();
    const password = cfg.password;
    if (!email || !password) {
        const step: HospedinTestStep = {
            step: 'Login',
            method: 'POST',
            url: `${cfg.apiUrl}/api/v2/authentication/sessions`,
            status: null,
            success: false,
            error: 'HOSPEDIN_EMAIL / HOSPEDIN_PASSWORD ausentes.',
        };
        steps.push(step);
        logStep(step);
        return fail('Login');
    }

    const loginMeta = await hospedinApiClient.requestMeta<HospedinAuthSession>(
        'POST',
        '/api/v2/authentication/sessions',
        { auth: false, data: { email, password } }
    );

    const loginStep: HospedinTestStep = {
        step: 'Login',
        method: loginMeta.method,
        url: loginMeta.url,
        status: loginMeta.status,
        success: loginMeta.success && Boolean(loginMeta.data?.token),
        durationMs: loginMeta.durationMs,
        requestBody: loginMeta.requestBody,
        detail: loginMeta.success
            ? `userId=${loginMeta.data?.user?.id ?? 'n/a'}; token=********`
            : undefined,
        error: loginMeta.success
            ? loginMeta.data?.token
                ? undefined
                : 'Resposta sem token'
            : loginMeta.errorMessage,
    };
    steps.push(loginStep);
    logStep(loginStep);
    if (!loginStep.success || !loginMeta.data?.token) return fail('Login');

    hospedinApiClient.setToken(loginMeta.data.token);
    result.authenticated = true;

    const accountId = (cfg.accountId || '').trim();
    const discoveryStep: HospedinTestStep = {
        step: 'Descoberta Account',
        method: null,
        url: null,
        status: accountId ? 200 : null,
        success: Boolean(accountId),
        detail: accountId
            ? `accountId=${accountId}; source=env (my_account ignorado)`
            : undefined,
        error: accountId
            ? undefined
            : 'Configure HOSPEDIN_ACCOUNT_ID (ex.: 69532).',
    };
    steps.push(discoveryStep);
    logStep(discoveryStep);
    if (!accountId) return fail('Descoberta Account');

    hospedinApiClient.setAccountId(accountId);
    result.accountId = accountId;
    result.accountSource = 'env';
    result.account = { id: accountId, source: 'env' };

    try {
        const places = await hospedinPlaceService.getPlaces(listParams, accountId);
        const placesStep: HospedinTestStep = {
            step: 'Places',
            method: 'GET',
            url: `${cfg.apiUrl}/api/v2/${accountId}/places`,
            status: 200,
            success: true,
            detail: `count=${totalFromList(places)}`,
        };
        steps.push(placesStep);
        logStep(placesStep);
        result.places = totalFromList(places);
    } catch (err: any) {
        const placesStep: HospedinTestStep = {
            step: 'Places',
            method: 'GET',
            url: `${cfg.apiUrl}/api/v2/${accountId}/places`,
            status: err?.status ?? 502,
            success: false,
            error: err?.message,
        };
        steps.push(placesStep);
        logStep(placesStep);
        return fail('Places');
    }

    try {
        const placeTypes = await hospedinPlaceService.getPlaceTypes(
            listParams,
            accountId
        );
        const step: HospedinTestStep = {
            step: 'Place Types',
            method: 'GET',
            url: `${cfg.apiUrl}/api/v2/${accountId}/place_types`,
            status: 200,
            success: true,
            detail: `count=${totalFromList(placeTypes)}`,
        };
        steps.push(step);
        logStep(step);
        result.placeTypes = totalFromList(placeTypes);
    } catch (err: any) {
        const step: HospedinTestStep = {
            step: 'Place Types',
            method: 'GET',
            url: `${cfg.apiUrl}/api/v2/${accountId}/place_types`,
            status: err?.status ?? 502,
            success: false,
            error: err?.message,
        };
        steps.push(step);
        logStep(step);
        return fail('Place Types');
    }

    try {
        const reservations = await hospedinReservationService.getReservations(
            listParams,
            accountId
        );
        const step: HospedinTestStep = {
            step: 'Reservations',
            method: 'GET',
            url: `${cfg.apiUrl}/api/v2/${accountId}/reservations`,
            status: 200,
            success: true,
            detail: `count=${totalFromList(reservations)}`,
        };
        steps.push(step);
        logStep(step);
        result.reservations = totalFromList(reservations);
    } catch (err: any) {
        const step: HospedinTestStep = {
            step: 'Reservations',
            method: 'GET',
            url: `${cfg.apiUrl}/api/v2/${accountId}/reservations`,
            status: err?.status ?? 502,
            success: false,
            error: err?.message,
        };
        steps.push(step);
        logStep(step);
        return fail('Reservations');
    }

    result.ok = true;
    return result;
}

export class HospedinConnectivityTestError extends Error {
    public readonly status: number;
    public readonly result: HospedinConnectivityTestResult;

    constructor(result: HospedinConnectivityTestResult) {
        const failed = result.failedAt || 'desconhecida';
        const failedStep = result.steps.find((s) => s.step === failed);
        super(
            `Hospedin test falhou na etapa "${failed}"${
                failedStep?.error ? `: ${failedStep.error}` : ''
            }`
        );
        this.name = 'HospedinConnectivityTestError';
        this.status =
            failedStep?.status && failedStep.status >= 400
                ? failedStep.status
                : 502;
        this.result = result;
    }
}

export async function runHospedinConnectivityTestOrThrow(): Promise<HospedinConnectivityTestResult> {
    const result = await runHospedinConnectivityTest();
    if (!result.ok) throw new HospedinConnectivityTestError(result);
    return result;
}
