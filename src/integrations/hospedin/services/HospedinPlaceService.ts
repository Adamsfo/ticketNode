import {
    hospedinApiClient,
    HospedinApiClient,
} from '../api/HospedinApiClient';
import type { HospedinPlaceDto, HospedinPlaceTypeDto } from '../dto';
import { HospedinPlaceMapper } from '../mapper/HospedinPlaceMapper';
import { HospedinPlaceTypeMapper } from '../mapper/HospedinPlaceTypeMapper';
import type {
    HospedinListParams,
    HospedinPaginatedResponse,
} from '../types';
import { hospedinAuthService, HospedinAuthService } from './HospedinAuthService';

/**
 * Leitura de Places / Place Types na API.
 * Sempre devolve DTOs (nunca JSON cru para a camada de importação).
 */
export class HospedinPlaceService {
    constructor(
        private readonly client: HospedinApiClient = hospedinApiClient,
        private readonly auth: HospedinAuthService = hospedinAuthService
    ) {}

    private async accountPath(
        suffix: string,
        accountId?: string
    ): Promise<string> {
        await this.auth.ensureAuthenticated();
        const id = await this.auth.ensureAccountId(accountId);
        return `/api/v2/${encodeURIComponent(id)}${suffix}`;
    }

    async listPlaceTypes(
        params?: HospedinListParams,
        accountId?: string
    ): Promise<HospedinPlaceTypeDto[]> {
        const path = await this.accountPath('/place_types', accountId);
        const response = await this.client.get<{ data?: unknown[] }>(path, {
            params,
        });
        const rows = Array.isArray(response?.data) ? response.data : [];
        return rows.map((row) => HospedinPlaceTypeMapper.toDto(row));
    }

    async listAllPlaceTypes(
        accountId?: string
    ): Promise<HospedinPlaceTypeDto[]> {
        const path = await this.accountPath('/place_types', accountId);
        const rows = await this.client.getAllPages<unknown>(path);
        return rows.map((row) => HospedinPlaceTypeMapper.toDto(row));
    }

    async listPlaces(
        params?: HospedinListParams,
        accountId?: string
    ): Promise<HospedinPlaceDto[]> {
        const path = await this.accountPath('/places', accountId);
        const response = await this.client.get<{ data?: unknown[] }>(path, {
            params,
        });
        const rows = Array.isArray(response?.data) ? response.data : [];
        return rows.map((row) => HospedinPlaceMapper.toDto(row));
    }

    async listAllPlaces(accountId?: string): Promise<HospedinPlaceDto[]> {
        const path = await this.accountPath('/places', accountId);
        const rows = await this.client.getAllPages<unknown>(path);
        return rows.map((row) => HospedinPlaceMapper.toDto(row));
    }

    /** Página crua tipada — uso interno/teste. Preferir listPlaces. */
    async getPlaces(
        params?: HospedinListParams,
        accountId?: string
    ): Promise<HospedinPaginatedResponse<unknown>> {
        const path = await this.accountPath('/places', accountId);
        return this.client.get<HospedinPaginatedResponse<unknown>>(path, {
            params,
        });
    }

    /** Página crua tipada — uso interno/teste. Preferir listPlaceTypes. */
    async getPlaceTypes(
        params?: HospedinListParams,
        accountId?: string
    ): Promise<HospedinPaginatedResponse<unknown>> {
        const path = await this.accountPath('/place_types', accountId);
        return this.client.get<HospedinPaginatedResponse<unknown>>(path, {
            params,
        });
    }
}

export const hospedinPlaceService = new HospedinPlaceService();
