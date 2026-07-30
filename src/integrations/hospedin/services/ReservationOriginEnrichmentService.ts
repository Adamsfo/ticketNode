import { createHash } from 'crypto';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaHospede } from '../../../models/ReservaHospede';
import { ReservaHospedeDocumento } from '../../../models/ReservaHospedeDocumento';
import { ReservaIdentificadorExterno } from '../../../models/ReservaIdentificadorExterno';
import { ReservaOrigemFinanceira } from '../../../models/ReservaOrigemFinanceira';
import { ReservaOrigemPayload } from '../../../models/ReservaOrigemPayload';
import { ReservaSuite } from '../../../models/ReservaSuite';
import type { HospedinReservation } from '../../../models/HospedinReservation';
import { asNumber, asRecord, asString } from '../mapper/mapperHelpers';
import { HospedinReservationDomainMapper } from '../mapper/HospedinReservationDomainMapper';
import { HospedinLogger } from '../logger/HospedinLogger';

export const INTEGRATION_PROVIDER_HOSPEDIN = 'HOSPEDIN';

/**
 * Persiste metadados multi-provedor na reserva Jango após CREATE/UPDATE.
 * Não altera o financeiro oficial (valor_total / valor_pago).
 */
export class ReservationOriginEnrichmentService {
    async enrichFromHospedinStaging(input: {
        idReservaHospedagem: number;
        staging: HospedinReservation;
        correlationId?: string;
    }): Promise<void> {
        const payload = readPayload(input.staging);
        const reservationId = String(
            input.staging.reservation_id || payload.id || ''
        );
        const searchableCode =
            asString(payload.searchable_code) ||
            asString((input.staging as any).searchable_code) ||
            null;
        const canalVenda = normalizeCanalVenda(payload);
        const observacoes =
            HospedinReservationDomainMapper.buildObservacoesFromStaging(
                input.staging
            );

        await ReservaHospedagem.update(
            {
                idExterno: reservationId || null,
                codigoExterno: searchableCode,
                canalVenda,
                observacoes,
            },
            { where: { id: input.idReservaHospedagem } }
        );

        await this.upsertIdentifiers(
            input.idReservaHospedagem,
            reservationId,
            searchableCode
        );
        await this.upsertFinance(input.idReservaHospedagem, payload);
        await this.upsertPayload(
            input.idReservaHospedagem,
            reservationId,
            'RESERVATION',
            payload
        );

        const mainGuest =
            asRecord(payload.main_guest) ||
            asRecord(payload.guest) ||
            null;
        if (mainGuest) {
            await this.upsertPayload(
                input.idReservaHospedagem,
                asString(mainGuest.id) || reservationId,
                'GUEST',
                mainGuest
            );
        }

        await this.syncGuestDocuments(
            input.idReservaHospedagem,
            payload
        );

        HospedinLogger.info('origin_enrichment:applied', {
            correlation_id: input.correlationId,
            id_reserva_hospedagem: input.idReservaHospedagem,
            id_externo: reservationId,
            codigo_externo: searchableCode,
            canal_venda: canalVenda,
        });
    }

    private async upsertIdentifiers(
        idReservaHospedagem: number,
        reservationId: string,
        searchableCode: string | null
    ): Promise<void> {
        const rows: Array<{ tipo: string; valor: string }> = [];
        if (reservationId) {
            rows.push({ tipo: 'RESERVATION_ID', valor: reservationId });
        }
        if (searchableCode) {
            rows.push({ tipo: 'SEARCHABLE_CODE', valor: searchableCode });
        }

        for (const row of rows) {
            const existing = await ReservaIdentificadorExterno.findOne({
                where: {
                    idReservaHospedagem,
                    provider: INTEGRATION_PROVIDER_HOSPEDIN,
                    tipo: row.tipo,
                },
            });
            if (existing) {
                if (existing.valor !== row.valor) {
                    await existing.update({ valor: row.valor });
                }
            } else {
                await ReservaIdentificadorExterno.create({
                    idReservaHospedagem,
                    provider: INTEGRATION_PROVIDER_HOSPEDIN,
                    tipo: row.tipo,
                    valor: row.valor,
                });
            }
        }
    }

    private async upsertFinance(
        idReservaHospedagem: number,
        payload: Record<string, unknown>
    ): Promise<void> {
        const paymentFromOta =
            payload.has_payment_coming_from_ota === true ||
            payload.has_payment_coming_from_ota === 1 ||
            payload.has_payment_coming_from_ota === 'true';

        const received = asNumber(payload.total_received);
        const toReceive = asNumber(payload.total_to_receive);
        const total = asNumber(payload.total_amount);

        let statusPagamento =
            asString(payload.payment_status) ||
            asString(payload.status_pagamento) ||
            asString(payload.financial_status) ||
            null;
        if (!statusPagamento) {
            if (received != null && total != null && received >= total && total > 0) {
                statusPagamento = 'PAID';
            } else if (received != null && received > 0) {
                statusPagamento = 'PARTIAL';
            } else if (toReceive != null && toReceive > 0) {
                statusPagamento = 'PENDING';
            } else if (total === 0) {
                statusPagamento = 'ZERO';
            }
        }

        const formaPagamento =
            asString(payload.payment_method) ||
            asString(payload.forma_pagamento) ||
            asString(payload.payment_type) ||
            null;

        const origemPagamento = paymentFromOta ? 'OTA' : 'PROPRIEDADE';
        const responsavelPagamento =
            asString(payload.payment_responsible) ||
            asString(payload.responsavel_pagamento) ||
            (paymentFromOta ? 'OTA' : 'PROPRIEDADE');

        const moeda =
            asString(payload.currency) ||
            asString(payload.price_currency) ||
            asString(payload.moeda) ||
            'BRL';

        const financeSnapshot = {
            daily_cents: payload.daily_cents ?? null,
            total_daily_cents: payload.total_daily_cents ?? null,
            total_amount: payload.total_amount ?? null,
            total_received: payload.total_received ?? null,
            total_to_receive: payload.total_to_receive ?? null,
            total_discount: payload.total_discount ?? null,
            total_product: payload.total_product ?? null,
            total_service: payload.total_service ?? null,
            total_items: payload.total_items ?? null,
            report_total_daily: payload.report_total_daily ?? null,
            has_payment_coming_from_ota: payload.has_payment_coming_from_ota ?? null,
            sale_channel_id: payload.sale_channel_id ?? null,
            sale_channel: payload.sale_channel ?? null,
            payment_status: statusPagamento,
            payment_method: formaPagamento,
            currency: moeda,
        };
        const payloadHash = hashJson(financeSnapshot);

        const values = {
            idReservaHospedagem,
            provider: INTEGRATION_PROVIDER_HOSPEDIN,
            moeda,
            totalCents: total,
            receivedCents: received,
            toReceiveCents: toReceive,
            dailyCents: asNumber(payload.daily_cents),
            totalDailyCents: asNumber(payload.total_daily_cents),
            discountCents: asNumber(payload.total_discount),
            productCents: asNumber(payload.total_product),
            serviceCents: asNumber(payload.total_service),
            itemsCount: asNumber(payload.total_items),
            paymentFromOta,
            statusPagamento,
            formaPagamento,
            origemPagamento,
            responsavelPagamento,
            rawJson: financeSnapshot,
            payloadHash,
            syncedAt: new Date(),
        };

        const existing = await ReservaOrigemFinanceira.findOne({
            where: {
                idReservaHospedagem,
                provider: INTEGRATION_PROVIDER_HOSPEDIN,
            },
        });
        if (existing) {
            if (existing.payloadHash === payloadHash) {
                await existing.update({ syncedAt: values.syncedAt });
                return;
            }
            await existing.update(values);
            return;
        }
        await ReservaOrigemFinanceira.create(values);
    }

    private async upsertPayload(
        idReservaHospedagem: number,
        externalId: string | null,
        kind: string,
        payload: Record<string, unknown>
    ): Promise<void> {
        const payloadHash = hashJson(payload);
        const existing = await ReservaOrigemPayload.findOne({
            where: {
                idReservaHospedagem,
                provider: INTEGRATION_PROVIDER_HOSPEDIN,
                kind,
            },
        });
        const capturedAt = new Date();
        if (existing) {
            if (existing.payloadHash === payloadHash) {
                await existing.update({ capturedAt });
                return;
            }
            await existing.update({
                externalId,
                payloadJson: payload,
                payloadHash,
                capturedAt,
            });
            return;
        }
        await ReservaOrigemPayload.create({
            idReservaHospedagem,
            provider: INTEGRATION_PROVIDER_HOSPEDIN,
            kind,
            externalId,
            payloadJson: payload,
            payloadHash,
            capturedAt,
        });
    }

    private async syncGuestDocuments(
        idReservaHospedagem: number,
        payload: Record<string, unknown>
    ): Promise<void> {
        const suites = await ReservaSuite.findAll({
            where: { idReservaHospedagem },
            include: [{ model: ReservaHospede, as: 'ReservaHospede' }],
            order: [['id', 'ASC']],
        });
        const hospedes = ((suites[0] as any)?.ReservaHospede || []) as Array<{
            id: number;
            nome: string;
        }>;
        if (!hospedes.length) return;

        const guestSources: Record<string, unknown>[] = [];
        const main =
            asRecord(payload.main_guest) ||
            asRecord(payload.guest) ||
            asRecord(payload.customer);
        if (main) guestSources.push(main);
        for (const key of ['guests', 'guest_list', 'reservation_guests', 'hospedes']) {
            const arr = payload[key];
            if (!Array.isArray(arr)) continue;
            for (const g of arr) {
                const rec = asRecord(g);
                if (rec) guestSources.push(rec);
            }
        }

        for (let i = 0; i < Math.min(hospedes.length, guestSources.length || 1); i++) {
            const hospede = hospedes[i];
            const source = guestSources[i] || guestSources[0];
            if (!source) continue;
            await this.upsertDocsForHospede(hospede.id, source);
        }
    }

    private async upsertDocsForHospede(
        idReservaHospede: number,
        source: Record<string, unknown>
    ): Promise<void> {
            const docs: Array<{ tipo: string; numero: string }> = [];
        const passport = asString(source.passport);
        if (passport) docs.push({ tipo: 'PASSPORT', numero: passport });

        const identification = asString(source.identification);
        if (identification) {
            docs.push({ tipo: 'IDENTIFICATION', numero: identification });
        }

        // document genérico (quando não for o mesmo que passport)
        const otherDoc = asString(source.document) || asString(source.documento);
        if (otherDoc && otherDoc !== passport && otherDoc !== identification) {
            docs.push({ tipo: 'OTHER', numero: otherDoc });
        }

        for (const doc of docs) {
            const existing = await ReservaHospedeDocumento.findOne({
                where: { idReservaHospede, tipo: doc.tipo },
            });
            if (existing) {
                if (existing.numero !== doc.numero) {
                    await existing.update({
                        numero: doc.numero,
                        provider: INTEGRATION_PROVIDER_HOSPEDIN,
                    });
                }
            } else {
                await ReservaHospedeDocumento.create({
                    idReservaHospede,
                    provider: INTEGRATION_PROVIDER_HOSPEDIN,
                    tipo: doc.tipo,
                    numero: doc.numero,
                });
            }
        }
    }
}

export const reservationOriginEnrichmentService =
    new ReservationOriginEnrichmentService();

export function normalizeCanalVenda(
    payload: Record<string, unknown>
): string {
    const raw =
        asString(payload.sale_channel) ||
        channelNameFromObject(payload.sale_channel) ||
        asString(payload.channel) ||
        asString(payload.canal) ||
        null;

    if (!raw) {
        if (payload.sale_channel_id != null && payload.sale_channel_id !== '') {
            return 'UNKNOWN';
        }
        return 'UNKNOWN';
    }

    const n = raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    if (n.includes('booking')) return 'BOOKING';
    if (n.includes('airbnb')) return 'AIRBNB';
    if (n.includes('expedia')) return 'EXPEDIA';
    if (n.includes('decolar') || n.includes('despegar')) return 'DECOLAR';
    if (n.includes('omnibees')) return 'OMNIBEES';
    if (n.includes('walk') || n.includes('balcao') || n.includes('recep')) {
        return 'WALK_IN';
    }
    if (
        n.includes('site') ||
        n.includes('direct') ||
        n.includes('direto') ||
        n.includes('hospedin')
    ) {
        return 'SITE';
    }

    return raw.slice(0, 40).toUpperCase().replace(/\s+/g, '_');
}

function channelNameFromObject(value: unknown): string | null {
    const rec = asRecord(value);
    if (!rec) return null;
    return asString(rec.name) || asString(rec.title) || asString(rec.label);
}

function readPayload(
    staging: HospedinReservation
): Record<string, unknown> {
    const raw = staging.payload_json as any;
    if (!raw) return {};
    if (typeof raw === 'string') {
        try {
            return asRecord(JSON.parse(raw)) || {};
        } catch {
            return {};
        }
    }
    return asRecord(raw) || {};
}

function hashJson(value: unknown): string {
    return createHash('sha256')
        .update(JSON.stringify(value ?? null))
        .digest('hex');
}
