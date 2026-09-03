import {
    hospedinApiClient,
    HospedinApiClient,
} from '../api/HospedinApiClient';
import { asNumber, asRecord } from '../mapper/mapperHelpers';
import { hospedinAuthService, HospedinAuthService } from '../services/HospedinAuthService';
import { hospedinOutboundStateService } from './HospedinOutboundStateService';

export type CreateGuestInput = {
    name: string;
};

/**
 * Criação/reuso de hóspede na Hospedin para outbound Jango → Hospedin.
 * Primeira homologação: somente campo documentado `name` no POST /guests.
 */
export class HospedinOutboundGuestService {
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

    async createGuest(
        input: CreateGuestInput,
        accountId?: string
    ): Promise<number> {
        const name = String(input.name || '').trim();
        if (!name) {
            throw new Error('Nome do hóspede é obrigatório para CREATE outbound.');
        }

        const path = await this.accountPath('/guests', accountId);
        const raw = await this.client.post<unknown>(path, { name });
        const guestId = asNumber(asRecord(raw).id);
        if (guestId == null || guestId <= 0) {
            throw new Error(
                'Hospedin POST /guests não retornou id válido do hóspede.'
            );
        }
        return guestId;
    }

    /**
     * Reutiliza hospedin_guest_id da fila ou cria hóspede e persiste na fila.
     */
    async resolveOrCreateGuestId(input: {
        outboundStateId: number;
        existingGuestId: string | null | undefined;
        guestName: string;
        accountId?: string;
    }): Promise<number> {
        const cached = asNumber(String(input.existingGuestId || '').trim());
        if (cached != null && cached > 0) {
            return cached;
        }

        const guestId = await this.createGuest(
            { name: input.guestName },
            input.accountId
        );

        await hospedinOutboundStateService.persistHospedinIds(
            input.outboundStateId,
            { hospedinGuestId: String(guestId) }
        );

        return guestId;
    }
}

export const hospedinOutboundGuestService = new HospedinOutboundGuestService();
