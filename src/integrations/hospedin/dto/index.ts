/**
 * DTOs Hospedin — fluxo obrigatório:
 * JSON API → DTO → Mapper.toInternal → Model staging
 */

export type HospedinPlaceTypeDto = {
    placeTypeId: number;
    nome: string;
    capacidade: number | null;
    ativo: boolean;
    sourcePayload: Record<string, unknown>;
};

export type HospedinPlaceDto = {
    placeId: number;
    placeTypeId: number | null;
    nome: string;
    capacidade: number | null;
    ativo: boolean;
    sourcePayload: Record<string, unknown>;
};

export type HospedinReservationDto = {
    reservationId: number;
    status: string | null;
    checkin: Date | null;
    checkout: Date | null;
    searchableCode: string | null;
    placeId: number | null;
    placeTypeId: number | null;
    sourcePayload: Record<string, unknown>;
};

/** Shape das tabelas hospedin_* (staging), sem ReservaHospedagem. */
export type InternalHospedinPlaceType = {
    place_type_id: number;
    nome: string;
    capacidade: number | null;
    payload_json: Record<string, unknown>;
    synced_at: Date;
};

export type InternalHospedinPlace = {
    place_id: number;
    place_type_id: number | null;
    nome: string;
    capacidade: number | null;
    ativo: boolean;
    payload_json: Record<string, unknown>;
    synced_at: Date;
};

export type InternalHospedinReservation = {
    reservation_id: number;
    status: string | null;
    checkin: Date | null;
    checkout: Date | null;
    payload_json: Record<string, unknown>;
    imported_at: Date;
    updated_at: Date;
};

export type HospedinImportResult = {
    operacao: string;
    /** Total retornado pela API (antes do filtro local). */
    fetched: number;
    upserted: number;
    accountId: string | null;
    durationMs: number;
    sucesso: boolean;
    erro?: string | null;
    /** incremental (padrão) | full (administrativo). */
    mode?: 'incremental' | 'full';
    /** Dias da janela histórica (checkout >= hoje - N). */
    historicalSyncDays?: number;
    /** Descartadas pelo filtro local (só incremental). */
    discarded?: number;
    /** Restante após filtro (= candidatos a enrich/upsert). */
    remaining?: number;
};
