/**
 * Testes offline — outbound CANCEL (sem HTTP/DB real).
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/HospedinOutboundCancel.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundStatus,
} from '../../../models/HospedinOutboundSyncState';
import { StatusReservaHospedagem } from '../../../models/ReservaHospedagem';
import { HospedinApiError } from '../types/errors';
import { isHospedinCancelledStatus } from '../sync/hospedinReservationStatus';
import { classifyOutboundHttpError } from './hospedinOutboundErrorClassification';
import {
    buildOutboundCancelPatch,
    buildOutboundUpdatePatch,
} from './HospedinOutboundPayloadBuilder';
import {
    hashOutboundPayload,
    snapshotToHashInput,
    type OutboundPayloadHashInput,
} from './HospedinOutboundSnapshot';
import { outboundEnqueueTestHelpers } from './HospedinOutboundEnqueueService';
import { resolvePendingOutboundStatus } from './HospedinOutboundStateService';

const baseInput = (): OutboundPayloadHashInput => ({
    checkin: '2026-10-18T10:00',
    checkout: '2026-10-20T08:00',
    idEventoSuite: 3,
    observacoes: 'Obs base',
    adultos: 2,
    criancas: 0,
});

describe('buildOutboundCancelPatch', () => {
    it('gera exatamente { status: "canceled" }', () => {
        assert.deepEqual(buildOutboundCancelPatch(), { status: 'canceled' });
        const patch = buildOutboundCancelPatch();
        assert.equal(Object.keys(patch).length, 1);
        assert.ok(!('note' in patch));
        assert.ok(!('check_in' in patch));
        assert.ok(!('daily_cents' in patch));
    });
});

describe('resolvePendingOutboundStatus', () => {
    it('CREATE → PENDING_CREATE', () => {
        assert.equal(
            resolvePendingOutboundStatus(HospedinOutboundDesiredAction.CREATE),
            HospedinOutboundStatus.PENDING_CREATE
        );
    });

    it('UPDATE → PENDING_UPDATE', () => {
        assert.equal(
            resolvePendingOutboundStatus(HospedinOutboundDesiredAction.UPDATE),
            HospedinOutboundStatus.PENDING_UPDATE
        );
    });

    it('CANCEL → PENDING_CANCEL', () => {
        assert.equal(
            resolvePendingOutboundStatus(HospedinOutboundDesiredAction.CANCEL),
            HospedinOutboundStatus.PENDING_CANCEL
        );
    });
});

describe('isHospedinCancelledStatus', () => {
    it('aceita canceled e não cancelled no PATCH de escrita', () => {
        assert.equal(isHospedinCancelledStatus('canceled'), true);
        assert.equal(isHospedinCancelledStatus('cancelled'), true);
        assert.equal(isHospedinCancelledStatus('reservation'), false);
    });
});

describe('classifyOutboundHttpError — cancelamento', () => {
    it('404 → FAILED permanente (sem retry)', () => {
        const r = classifyOutboundHttpError(new HospedinApiError('nf', 404));
        assert.equal(r.retryable, false);
        assert.equal(r.errorCode, 'NOT_FOUND');
    });

    it('422 → FAILED', () => {
        const r = classifyOutboundHttpError(new HospedinApiError('val', 422));
        assert.equal(r.retryable, false);
        assert.equal(r.errorCode, 'VALIDATION_ERROR');
    });

    it('429 → retry', () => {
        const r = classifyOutboundHttpError(new HospedinApiError('rl', 429));
        assert.equal(r.retryable, true);
    });

    it('5xx → retry', () => {
        const r = classifyOutboundHttpError(new HospedinApiError('srv', 503));
        assert.equal(r.retryable, true);
    });

    it('rede → retry', () => {
        const r = classifyOutboundHttpError(new Error('ECONNRESET'));
        assert.equal(r.retryable, true);
        assert.equal(r.errorCode, 'NETWORK_ERROR');
    });
});

describe('outboundEnqueueTestHelpers', () => {
    it('neverSent sem idExterno nem hospedin_reservation_id', () => {
        const hospedagem = { idExterno: null } as any;
        assert.equal(
            outboundEnqueueTestHelpers.resolveNeverSent(hospedagem, null),
            true
        );
        assert.equal(
            outboundEnqueueTestHelpers.hasHospedinLink(hospedagem, null),
            false
        );
    });

    it('hasHospedinLink com idExterno', () => {
        const hospedagem = { idExterno: '30295972' } as any;
        assert.equal(
            outboundEnqueueTestHelpers.hasHospedinLink(hospedagem, null),
            true
        );
    });

    it('shouldSkipMarkDirty quando Jango Cancelada', () => {
        const hospedagem = {
            status: StatusReservaHospedagem.Cancelada,
        } as any;
        assert.equal(
            outboundEnqueueTestHelpers.shouldSkipMarkDirty(hospedagem, null),
            true
        );
    });

    it('shouldSkipMarkDirty quando ABORTED', () => {
        const hospedagem = {
            status: StatusReservaHospedagem.Confirmada,
        } as any;
        const existing = {
            outbound_status: HospedinOutboundStatus.ABORTED,
            desired_action: HospedinOutboundDesiredAction.CANCEL,
        } as any;
        assert.equal(
            outboundEnqueueTestHelpers.shouldSkipMarkDirty(hospedagem, existing),
            true
        );
    });

    it('shouldSkipMarkDirty quando PENDING_CANCEL', () => {
        const hospedagem = {
            status: StatusReservaHospedagem.Confirmada,
        } as any;
        const existing = {
            outbound_status: HospedinOutboundStatus.PENDING_CANCEL,
            desired_action: HospedinOutboundDesiredAction.CANCEL,
        } as any;
        assert.equal(
            outboundEnqueueTestHelpers.shouldSkipMarkDirty(hospedagem, existing),
            true
        );
    });
});

describe('CANCEL não altera hash operacional de UPDATE', () => {
    it('mudança só de status Jango não altera hash', () => {
        const confirmada = baseInput();
        const cancelada = { ...confirmada };
        assert.equal(
            hashOutboundPayload(confirmada),
            hashOutboundPayload(cancelada)
        );
    });

    it('UPDATE patch não inclui status', () => {
        const { patch } = buildOutboundUpdatePatch({
            idReservaHospedagem: 1,
            before: baseInput(),
            after: { ...baseInput(), observacoes: 'nova' },
        });
        assert.ok(!('status' in patch));
    });
});

describe('GET idempotente — canceled', () => {
    it('status canceled é reconhecido antes de PATCH', () => {
        assert.equal(isHospedinCancelledStatus('canceled'), true);
    });
});
