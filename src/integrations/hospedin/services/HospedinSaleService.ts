import {
    hospedinApiClient,
    HospedinApiClient,
} from '../api/HospedinApiClient';
import type { HospedinOutboundSaleInput } from '../outbound/HospedinOutboundSalePayloadBuilder';
import { hospedinAuthService, HospedinAuthService } from './HospedinAuthService';

export type HospedinSaleDto = {
    id: number;
    item_id: number;
    selling_point_id: number;
    quantity: number;
    price_cents: number;
    note?: string | null;
};

function extractSales(body: unknown): HospedinSaleDto[] {
    if (!body || typeof body !== 'object') return [];
    const record = body as { data?: unknown };
    if (Array.isArray(record.data)) {
        return record.data as HospedinSaleDto[];
    }
    if (Array.isArray(body)) {
        return body as HospedinSaleDto[];
    }
    return [];
}

function toSaleDto(raw: unknown): HospedinSaleDto {
    const row = raw as Record<string, unknown>;
    return {
        id: Number(row.id),
        item_id: Number(row.item_id),
        selling_point_id: Number(row.selling_point_id),
        quantity: Number(row.quantity),
        price_cents: Number(row.price_cents),
        note: row.note != null ? String(row.note) : null,
    };
}

/**
 * HTTP exclusivo para SALE aninhada em reservation.
 * Sem PATCH — substituição financeira usa DELETE + POST.
 */
export class HospedinSaleService {
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

    async listSales(
        reservationId: string | number,
        accountId?: string
    ): Promise<HospedinSaleDto[]> {
        const path = await this.accountPath(
            `/reservations/${encodeURIComponent(String(reservationId))}/sales`,
            accountId
        );
        const raw = await this.client.get<unknown>(path);
        return extractSales(raw).map(toSaleDto);
    }

    async createSale(
        reservationId: string | number,
        input: HospedinOutboundSaleInput,
        accountId?: string
    ): Promise<HospedinSaleDto> {
        const path = await this.accountPath(
            `/reservations/${encodeURIComponent(String(reservationId))}/sales`,
            accountId
        );
        const raw = await this.client.post<unknown>(path, input);
        return toSaleDto(raw);
    }

    async deleteSale(
        reservationId: string | number,
        saleId: string | number,
        accountId?: string
    ): Promise<void> {
        const path = await this.accountPath(
            `/reservations/${encodeURIComponent(String(reservationId))}/sales/${encodeURIComponent(String(saleId))}`,
            accountId
        );
        await this.client.delete(path);
    }
}

export const hospedinSaleService = new HospedinSaleService();
