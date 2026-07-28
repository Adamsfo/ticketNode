/**
 * @deprecated Etapa 2.5 — não usar no Channel Manager MVP.
 * /sale_channels retorna 403 para o usuário atual.
 * Mantido apenas para referência futura (owner/admin).
 */
import {
    hospedinApiClient,
    HospedinApiClient,
} from '../api/HospedinApiClient';
import type {
    HospedinListParams,
    HospedinPaginatedResponse,
    HospedinSaleChannel,
} from '../types';
import { hospedinAuthService, HospedinAuthService } from './HospedinAuthService';

export class HospedinSaleChannelService {
    constructor(
        private readonly client: HospedinApiClient = hospedinApiClient,
        private readonly auth: HospedinAuthService = hospedinAuthService
    ) {}

    async getSaleChannels(
        params?: HospedinListParams,
        accountId?: string
    ): Promise<HospedinPaginatedResponse<HospedinSaleChannel>> {
        await this.auth.ensureAuthenticated();
        const id = await this.auth.ensureAccountId(accountId);
        return this.client.get<HospedinPaginatedResponse<HospedinSaleChannel>>(
            `/api/v2/${encodeURIComponent(id)}/sale_channels`,
            { params }
        );
    }
}

export const hospedinSaleChannelService = new HospedinSaleChannelService();
