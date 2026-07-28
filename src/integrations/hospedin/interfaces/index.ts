/**
 * Contratos do módulo Hospedin (staging / API).
 * Isolado do domínio de Hospedagem do Jango.
 */

import type {
    HospedinPlaceDto,
    HospedinPlaceTypeDto,
    HospedinReservationDto,
} from '../dto';
import type { HospedinAuthSession, HospedinListParams } from '../types';

export interface IHospedinAuthService {
    login(email?: string, password?: string): Promise<HospedinAuthSession>;
    refresh(): Promise<HospedinAuthSession>;
    logout(): void;
    getToken(): string | null;
    getAccountId(): string | null;
    ensureAuthenticated(): Promise<string>;
    ensureAccountId(override?: string | null): Promise<string>;
}

export interface IHospedinPlaceService {
    listPlaceTypes(
        params?: HospedinListParams,
        accountId?: string
    ): Promise<HospedinPlaceTypeDto[]>;
    listAllPlaceTypes(accountId?: string): Promise<HospedinPlaceTypeDto[]>;
    listPlaces(
        params?: HospedinListParams,
        accountId?: string
    ): Promise<HospedinPlaceDto[]>;
    listAllPlaces(accountId?: string): Promise<HospedinPlaceDto[]>;
}

export interface IHospedinReservationService {
    listReservations(
        params?: HospedinListParams,
        accountId?: string
    ): Promise<HospedinReservationDto[]>;
    listAllReservations(accountId?: string): Promise<HospedinReservationDto[]>;
    getReservationDto(
        reservationId: string | number,
        accountId?: string
    ): Promise<HospedinReservationDto>;
}

export interface IHospedinSyncService {
    importPlaceTypes(): Promise<unknown>;
    importPlaces(): Promise<unknown>;
    importReservations(options?: { fetchDetails?: boolean }): Promise<unknown>;
}
