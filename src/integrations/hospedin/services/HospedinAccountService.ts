/**
 * @deprecated Etapa 2.5 — não usar no Channel Manager MVP.
 * /my_account e /companies retornam 403 para o usuário atual.
 * Mantido apenas para referência futura (owner/admin).
 */
import {
    hospedinApiClient,
    HospedinApiClient,
} from '../api/HospedinApiClient';
import type { HospedinCompany } from '../types';
import { hospedinAuthService, HospedinAuthService } from './HospedinAuthService';

export type HospedinAccount = Record<string, unknown> & {
    id: number | string;
    name?: string;
    email?: string;
    slug?: string;
};

export class HospedinAccountService {
    constructor(
        private readonly client: HospedinApiClient = hospedinApiClient,
        private readonly auth: HospedinAuthService = hospedinAuthService
    ) {}

    async getMyAccount(accountId?: string): Promise<HospedinAccount> {
        await this.auth.ensureAuthenticated();
        const id = await this.auth.ensureAccountId(accountId);
        return this.client.get<HospedinAccount>(
            `/api/v2/${encodeURIComponent(id)}/my_account`
        );
    }

    async getCompanies(
        accountId?: string
    ): Promise<{ data: HospedinCompany[]; pagination?: unknown }> {
        await this.auth.ensureAuthenticated();
        const id = await this.auth.ensureAccountId(accountId);
        return this.client.get(
            `/api/v2/${encodeURIComponent(id)}/companies`
        );
    }
}

export const hospedinAccountService = new HospedinAccountService();
