/**
 * Testes offline — payload outbound CREATE (sem HTTP/DB).
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/HospedinOutboundPayloadBuilder.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    buildOutboundReservationPayload,
    formatOutboundCheckDatetime,
    OUTBOUND_CREATE_DEFERRED_STATUS,
    OUTBOUND_CREATE_ELIGIBLE_STATUSES,
    OUTBOUND_CREATE_TERMINAL_STATUSES,
} from './HospedinOutboundPayloadBuilder';
import { StatusReservaHospedagem } from '../../../models/ReservaHospedagem';
import { classifyOutboundHttpError } from './hospedinOutboundErrorClassification';
import { HospedinApiError } from '../types/errors';

describe('formatOutboundCheckDatetime', () => {
    it('formata com timezone de hospedagem (America/Cuiaba)', () => {
        const d = new Date('2026-10-17T17:00:00.000Z');
        const formatted = formatOutboundCheckDatetime(d);
        assert.ok(formatted);
        assert.match(formatted!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });
});

describe('buildOutboundReservationPayload', () => {
    it('monta payload operacional sem campos financeiros extras', () => {
        const payload = buildOutboundReservationPayload({
            idReservaHospedagem: 124,
            checkin: new Date('2026-10-17T17:00:00.000Z'),
            checkout: new Date('2026-10-19T15:00:00.000Z'),
            observacoes: 'Obs teste',
            adultos: 2,
            criancas: 1,
            preco: 400,
            valorTotal: 800,
            placeId: 445906,
            placeTypeId: 131939,
            guestId: 17942028,
        });

        assert.equal(payload.status, 'reservation');
        assert.equal(payload.place_id, 445906);
        assert.equal(payload.place_type_id, 131939);
        assert.equal(payload.adults, 2);
        assert.equal(payload.children, 1);
        assert.equal(payload.exempt, 0);
        assert.equal(payload.guest_id, 17942028);
        assert.equal(payload.daily_cents, 40000);
        assert.equal(payload.total_daily_cents, 80000);
        assert.equal(payload.has_payment_coming_from_ota, false);
        assert.equal(payload.has_breakfast, false);
        assert.equal(payload.sale_channel_id, null);
        assert.ok(payload.note?.includes('Reserva Jango #124'));
        assert.ok(payload.note?.includes('Obs teste'));
        assert.ok(!('total_received' in payload));
        assert.ok(!('total_amount' in payload));
    });

    it('garante ao menos 1 adulto', () => {
        const payload = buildOutboundReservationPayload({
            idReservaHospedagem: 1,
            checkin: new Date('2026-10-17T17:00:00.000Z'),
            checkout: new Date('2026-10-19T15:00:00.000Z'),
            adultos: 0,
            criancas: 0,
            preco: 100,
            valorTotal: 200,
            placeId: 1,
            placeTypeId: 2,
            guestId: 9,
        });
        assert.equal(payload.adults, 1);
    });
});

describe('status sets', () => {
    it('CREATE elegível somente Confirmada/Hospedada', () => {
        assert.equal(
            OUTBOUND_CREATE_ELIGIBLE_STATUSES.has(
                StatusReservaHospedagem.Confirmada
            ),
            true
        );
        assert.equal(
            OUTBOUND_CREATE_ELIGIBLE_STATUSES.has(
                StatusReservaHospedagem.AguardandoPagamento
            ),
            false
        );
        assert.equal(
            OUTBOUND_CREATE_DEFERRED_STATUS,
            StatusReservaHospedagem.AguardandoPagamento
        );
        assert.equal(
            OUTBOUND_CREATE_TERMINAL_STATUSES.has(
                StatusReservaHospedagem.Cancelada
            ),
            true
        );
    });
});

describe('classifyOutboundHttpError', () => {
    it('classifica 422 como permanente', () => {
        const r = classifyOutboundHttpError(
            new HospedinApiError('validation', 422, null)
        );
        assert.equal(r.retryable, false);
        assert.equal(r.errorCode, 'VALIDATION_ERROR');
    });

    it('classifica 429 como retry', () => {
        const r = classifyOutboundHttpError(
            new HospedinApiError('rate', 429, null)
        );
        assert.equal(r.retryable, true);
        assert.equal(r.errorCode, 'RATE_LIMITED');
    });
});
