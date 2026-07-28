import {
    hospedinApiClient,
    HospedinApiClient,
} from '../api/HospedinApiClient';
import { getHospedinConfig } from '../constants/config';
import { HospedinLogger } from '../logger/HospedinLogger';
import { HospedinApiError } from '../types/errors';
import type { HospedinAuthSession, HospedinAuthUser } from '../types';
import {
    resolveHospedinAccountId,
    type HospedinAccountSource,
} from '../utils/resolveAccountId';

/**
 * Autenticação Hospedin + account_id em memória.
 * Refresh = re-login (API sem refresh token).
 */
export class HospedinAuthService {
    private lastUser: HospedinAuthUser | null = null;
    private lastAccountSource: HospedinAccountSource | null = null;
    private renewerRegistered = false;

    constructor(private readonly client: HospedinApiClient = hospedinApiClient) {
        this.registerTokenRenewer();
    }

    private registerTokenRenewer(): void {
        if (this.renewerRegistered) return;
        this.client.setTokenRenewer(async () => {
            await this.refresh();
        });
        this.renewerRegistered = true;
    }

    async login(
        email?: string,
        password?: string,
        options?: { preserveAccountId?: boolean }
    ): Promise<HospedinAuthSession> {
        const cfg = getHospedinConfig();
        const mail = (email || cfg.email || '').trim();
        const pass = password ?? cfg.password;
        const previousAccount = options?.preserveAccountId
            ? this.client.getAccountId()
            : null;

        if (!mail || !pass) {
            throw new HospedinApiError(
                'Hospedin: informe HOSPEDIN_EMAIL e HOSPEDIN_PASSWORD (ou passe email/senha).',
                400
            );
        }

        HospedinLogger.auth('login iniciado', { email: mail });

        const session = await this.client.post<HospedinAuthSession>(
            '/api/v2/authentication/sessions',
            { email: mail, password: pass },
            { auth: false, renewOn401: false }
        );

        if (!session?.token) {
            HospedinLogger.error('login sem token na resposta');
            throw new HospedinApiError(
                'Hospedin: login sem token na resposta.',
                502,
                session
            );
        }

        this.client.setToken(session.token);
        this.lastUser = session.user ?? null;

        if (previousAccount) {
            this.client.setAccountId(previousAccount);
        } else {
            this.client.setAccountId(null);
            this.lastAccountSource = null;
            try {
                await this.ensureAccountId();
            } catch (err: any) {
                HospedinLogger.warn(
                    'descoberta de account_id adiada após login',
                    { message: err?.message }
                );
            }
        }

        HospedinLogger.auth('login ok; token em memória', {
            userId: session.user?.id,
            email: session.user?.email,
        });

        return session;
    }

    /**
     * A API não documenta refresh token — re-login preservando account_id.
     */
    async refresh(): Promise<HospedinAuthSession> {
        HospedinLogger.auth('refresh (re-login)');
        return this.login(undefined, undefined, { preserveAccountId: true });
    }

    logout(): void {
        this.client.setToken(null);
        this.client.setAccountId(null);
        this.lastUser = null;
        this.lastAccountSource = null;
        HospedinLogger.auth('logout; token e account_id limpos da memória');
    }

    getToken(): string | null {
        return this.client.getToken();
    }

    getAccountId(): string | null {
        return this.client.getAccountId();
    }

    getAccountSource(): HospedinAccountSource | null {
        return this.lastAccountSource;
    }

    getUser(): HospedinAuthUser | null {
        return this.lastUser;
    }

    async ensureAuthenticated(): Promise<string> {
        const existing = this.getToken();
        if (existing) return existing;
        const session = await this.login();
        return session.token;
    }

    async ensureAccountId(override?: string | null): Promise<string> {
        await this.ensureAuthenticated();
        const result = await resolveHospedinAccountId(this.client, {
            override,
        });
        this.lastAccountSource = result.source;
        HospedinLogger.auth('account_id pronto', {
            accountId: result.accountId,
            source: result.source,
        });
        return result.accountId;
    }
}

export const hospedinAuthService = new HospedinAuthService();
