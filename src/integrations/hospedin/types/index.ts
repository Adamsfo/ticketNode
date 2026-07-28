export type HospedinPagination = {
    page?: number;
    limit?: number;
    last?: number;
    count?: number;
};

export type HospedinPaginatedResponse<T> = {
    pagination?: HospedinPagination;
    data: T[];
};

export type HospedinAuthUser = {
    id: number;
    email: string;
    picture_url?: string | null;
    created_at?: string;
    updated_at?: string;
};

export type HospedinAuthSession = {
    token: string;
    user: HospedinAuthUser;
};

export type HospedinPlace = Record<string, unknown> & {
    id: number | string;
    name?: string;
    title?: string;
};

export type HospedinPlaceType = Record<string, unknown> & {
    id: number | string;
    title?: string;
    status?: string;
};

export type HospedinReservation = Record<string, unknown> & {
    id: number | string;
    searchable_code?: string;
    status?: string;
};

export type HospedinSaleChannel = Record<string, unknown> & {
    id: number | string;
    name?: string;
    title?: string;
};

export type HospedinCompany = Record<string, unknown> & {
    id: number | string;
    name?: string;
};

export type HospedinListParams = {
    page?: number;
    limit?: number;
    [key: string]: string | number | boolean | undefined | null;
};
