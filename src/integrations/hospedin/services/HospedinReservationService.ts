import {
    hospedinApiClient,
    HospedinApiClient,
} from '../api/HospedinApiClient';
import type { HospedinReservationDto } from '../dto';
import { HospedinReservationMapper } from '../mapper/HospedinReservationMapper';
import type {
    HospedinListParams,
    HospedinPaginatedResponse,
} from '../types';
import { hospedinAuthService, HospedinAuthService } from './HospedinAuthService';

/**
 * Leitura de Reservations na API.
 * Sempre devolve DTOs (nunca JSON cru para a camada de importação).
 */
export class HospedinReservationService {
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

    async listReservations(
        params?: HospedinListParams,
        accountId?: string
    ): Promise<HospedinReservationDto[]> {
        const path = await this.accountPath('/reservations', accountId);
        const response = await this.client.get<{ data?: unknown[] }>(path, {
            params,
        });
        const rows = Array.isArray(response?.data) ? response.data : [];
        return rows.map((row) => HospedinReservationMapper.toDto(row));
    }

    async listAllReservations(
        accountId?: string
    ): Promise<HospedinReservationDto[]> {
        const path = await this.accountPath('/reservations', accountId);
        const rows = await this.client.getAllPages<unknown>(path);
        return rows.map((row) => HospedinReservationMapper.toDto(row));
    }

    async getReservationDto(
        reservationId: string | number,
        accountId?: string
    ): Promise<HospedinReservationDto> {
        const path = await this.accountPath(
            `/reservations/${encodeURIComponent(String(reservationId))}`,
            accountId
        );
        const raw = await this.client.get<unknown>(path);
        return HospedinReservationMapper.toDto(raw);
    }

    /** Página crua tipada — uso interno/teste. Preferir listReservations. */
    async getReservations(
        params?: HospedinListParams,
        accountId?: string
    ): Promise<HospedinPaginatedResponse<unknown>> {
        const path = await this.accountPath('/reservations', accountId);
        return this.client.get<HospedinPaginatedResponse<unknown>>(path, {
            params,
        });
    }

    /** Página crua tipada — uso interno/teste. Preferir getReservationDto. */
    async getReservation(
        reservationId: string | number,
        accountId?: string
    ): Promise<unknown> {
        const path = await this.accountPath(
            `/reservations/${encodeURIComponent(String(reservationId))}`,
            accountId
        );
        return this.client.get(path);
    }
}

export const hospedinReservationService = new HospedinReservationService();
