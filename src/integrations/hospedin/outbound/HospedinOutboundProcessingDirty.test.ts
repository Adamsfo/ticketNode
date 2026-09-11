/**
 * PROCESSING + markDirty + markSynced + recoverStaleProcessing
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundStatus,
} from '../../../models/HospedinOutboundSyncState';
import { _setOutboundDispatcherTestDeps } from './HospedinOutboundDispatcher';
import { markDirty, outboundEnqueueTestHelpers } from './HospedinOutboundEnqueueService';
import {
    hospedinOutboundStateService,
    resolvePendingOutboundStatus,
} from './HospedinOutboundStateService';
import { shouldRequeueAfterAppliedSync } from './hospedinOutboundSyncFinalize';
import {
    buildSyncBaselineFromReserva,
    hashOutboundPayload,
} from './HospedinOutboundSnapshot';
import { OutboundIntegrationStore } from './OutboundIntegrationStore';

const baseInput = {
    checkin: '2026-09-11T16:00',
    checkout: '2026-09-12T13:00',
    idEventoSuite: 1,
    observacoes: null,
    adultos: 1,
    criancas: 0,
};

function hashForReservaFixture(
    store: OutboundIntegrationStore,
    idReserva: number
): string {
    const reserva = store.reservas.get(idReserva);
    return hashOutboundPayload(buildSyncBaselineFromReserva(reserva as any));
}

describe('shouldRequeueAfterAppliedSync', () => {
    it('requeue quando pending difere do aplicado', () => {
        assert.equal(
            shouldRequeueAfterAppliedSync('hash-400', 'hash-600'),
            true
        );
    });

    it('não requeue quando pending igual ao aplicado', () => {
        assert.equal(
            shouldRequeueAfterAppliedSync('hash-600', 'hash-600'),
            false
        );
    });
});

describe('resolveNextQueueState — PROCESSING', () => {
    it('mantém PROCESSING e desired_action existente', () => {
        const next = outboundEnqueueTestHelpers.resolveNextQueueState({
            neverSent: false,
            existing: {
                outbound_status: HospedinOutboundStatus.PROCESSING,
                desired_action: HospedinOutboundDesiredAction.UPDATE,
                last_error: null,
                error_code: null,
            } as any,
            preconditions: { ok: true, errorCode: null, lastError: null },
        });

        assert.equal(next.outbound_status, HospedinOutboundStatus.PROCESSING);
        assert.equal(next.desired_action, HospedinOutboundDesiredAction.UPDATE);
    });
});

describe('markDirty durante PROCESSING', () => {
    let store: OutboundIntegrationStore;
    let savedMocks: ReturnType<OutboundIntegrationStore['installMocks']>;

    beforeEach(() => {
        store = new OutboundIntegrationStore();
        savedMocks = store.installMocks();
        _setOutboundDispatcherTestDeps({ suppressSchedule: true });
    });

    afterEach(() => {
        store.restoreMocks(savedMocks);
    });

    function seedSynced900(idReserva: number): void {
        store.seedReserva({
            id: idReserva,
            idExterno: '30428400',
            valorTotal: 900,
            checkin: new Date('2026-09-11T20:00:00.000Z'),
            checkout: new Date('2026-09-12T17:00:00.000Z'),
            ReservaSuite: [
                {
                    idEventoSuite: 1,
                    adultos: 1,
                    criancas: 0,
                    ReservaHospede: [{ nome: 'Hospede' }],
                },
            ],
        });
        const hash900 = hashForReservaFixture(store, idReserva);
        store.seedQueueRow({
            id_reserva_hospedagem: idReserva,
            outbound_status: HospedinOutboundStatus.SYNCED,
            desired_action: HospedinOutboundDesiredAction.UPDATE,
            payload_hash: hash900,
            pending_payload_hash: hash900,
            hospedin_reservation_id: '30428400',
            synced_hash_input_json: JSON.stringify({
                ...baseInput,
                valorTotalCents: 90000,
            }),
        });
    }

    it('900→400: markDirty gera PENDING_UPDATE', async () => {
        seedSynced900(15701);
        store.reservas.get(15701)!.valorTotal = 400;

        await markDirty(15701);

        const row = store.getRowByReserva(15701)!;
        assert.equal(row.outbound_status, HospedinOutboundStatus.PENDING_UPDATE);
        assert.equal(row.pending_payload_hash, hashForReservaFixture(store, 15701));
    });

    it('PROCESSING + 400→600 conserva lock e pending mais recente', async () => {
        seedSynced900(15702);
        const hash900 = hashForReservaFixture(store, 15702);
        store.reservas.get(15702)!.valorTotal = 400;
        const hash400 = hashForReservaFixture(store, 15702);

        store.seedQueueRow({
            id_reserva_hospedagem: 15702,
            outbound_status: HospedinOutboundStatus.PROCESSING,
            desired_action: HospedinOutboundDesiredAction.UPDATE,
            payload_hash: hash900,
            pending_payload_hash: hash400,
            hospedin_reservation_id: '30428400',
            processing_started_at: new Date(),
            processing_correlation_id: 'corr-1',
        });

        store.reservas.get(15702)!.valorTotal = 600;
        await markDirty(15702);

        const row = store.getRowByReserva(15702)!;
        const hash600 = hashForReservaFixture(store, 15702);
        assert.equal(row.outbound_status, HospedinOutboundStatus.PROCESSING);
        assert.equal(row.processing_correlation_id, 'corr-1');
        assert.equal(row.pending_payload_hash, hash600);
    });

    it('900→400→600 durante PROCESSING: pending final = 600', async () => {
        seedSynced900(15703);
        const hash900 = hashForReservaFixture(store, 15703);
        store.reservas.get(15703)!.valorTotal = 400;
        const hash400 = hashForReservaFixture(store, 15703);

        store.seedQueueRow({
            id_reserva_hospedagem: 15703,
            outbound_status: HospedinOutboundStatus.PROCESSING,
            desired_action: HospedinOutboundDesiredAction.UPDATE,
            payload_hash: hash900,
            pending_payload_hash: hash400,
            hospedin_reservation_id: '30428400',
            processing_started_at: new Date(),
            processing_correlation_id: 'corr-2',
        });

        store.reservas.get(15703)!.valorTotal = 600;
        await markDirty(15703);

        assert.equal(
            store.getRowByReserva(15703)?.pending_payload_hash,
            hashForReservaFixture(store, 15703)
        );
    });

    it('900→400→600→700 durante PROCESSING: pending final = 700', async () => {
        seedSynced900(15704);
        const hash900 = hashForReservaFixture(store, 15704);
        store.reservas.get(15704)!.valorTotal = 600;
        const hash600 = hashForReservaFixture(store, 15704);

        store.seedQueueRow({
            id_reserva_hospedagem: 15704,
            outbound_status: HospedinOutboundStatus.PROCESSING,
            desired_action: HospedinOutboundDesiredAction.UPDATE,
            payload_hash: hash900,
            pending_payload_hash: hash600,
            hospedin_reservation_id: '30428400',
            processing_started_at: new Date(),
            processing_correlation_id: 'corr-3',
        });

        store.reservas.get(15704)!.valorTotal = 700;
        await markDirty(15704);

        assert.equal(
            store.getRowByReserva(15704)?.pending_payload_hash,
            hashForReservaFixture(store, 15704)
        );
    });
});

describe('markSynced com pending mais recente', () => {
    let store: OutboundIntegrationStore;
    let savedMocks: ReturnType<OutboundIntegrationStore['installMocks']>;

    beforeEach(() => {
        store = new OutboundIntegrationStore();
        savedMocks = store.installMocks();
        _setOutboundDispatcherTestDeps({ suppressSchedule: true });
    });

    afterEach(() => {
        store.restoreMocks(savedMocks);
    });

    it('aplicado 400 com pending 600 → PENDING_UPDATE', async () => {
        const hash400 = hashOutboundPayload({
            ...baseInput,
            valorTotalCents: 40000,
        });
        const hash600 = hashOutboundPayload({
            ...baseInput,
            valorTotalCents: 60000,
        });
        const row = store.seedQueueRow({
            id_reserva_hospedagem: 15710,
            outbound_status: HospedinOutboundStatus.PROCESSING,
            desired_action: HospedinOutboundDesiredAction.UPDATE,
            payload_hash: hashOutboundPayload({
                ...baseInput,
                valorTotalCents: 90000,
            }),
            pending_payload_hash: hash600,
            hospedin_reservation_id: '30428400',
            processing_started_at: new Date(),
            processing_correlation_id: 'corr-old',
        });

        const outcome = await hospedinOutboundStateService.markSynced(row.id, {
            hospedinReservationId: '30428400',
            syncedHashInputJson: JSON.stringify({
                ...baseInput,
                valorTotalCents: 40000,
            }),
            appliedPayloadHash: hash400,
        });

        assert.equal(outcome, 'pending_again');
        const after = store.getRowByReserva(15710)!;
        assert.equal(after.outbound_status, HospedinOutboundStatus.PENDING_UPDATE);
        assert.equal(after.payload_hash, hash400);
        assert.equal(after.pending_payload_hash, hash600);
        assert.equal(after.processing_started_at, null);
        assert.equal(after.processing_correlation_id, null);
    });

    it('aplicado 600 com pending 600 → SYNCED', async () => {
        const hash600 = hashOutboundPayload({
            ...baseInput,
            valorTotalCents: 60000,
        });
        const row = store.seedQueueRow({
            id_reserva_hospedagem: 15711,
            outbound_status: HospedinOutboundStatus.PROCESSING,
            desired_action: HospedinOutboundDesiredAction.UPDATE,
            payload_hash: hashOutboundPayload({
                ...baseInput,
                valorTotalCents: 90000,
            }),
            pending_payload_hash: hash600,
            hospedin_reservation_id: '30428400',
            processing_started_at: new Date(),
        });

        const outcome = await hospedinOutboundStateService.markSynced(row.id, {
            appliedPayloadHash: hash600,
            syncedHashInputJson: JSON.stringify({
                ...baseInput,
                valorTotalCents: 60000,
            }),
        });

        assert.equal(outcome, 'synced');
        const after = store.getRowByReserva(15711)!;
        assert.equal(after.outbound_status, HospedinOutboundStatus.SYNCED);
        assert.equal(after.payload_hash, hash600);
        assert.equal(after.pending_payload_hash, hash600);
    });
});

describe('recoverStaleProcessing', () => {
    let store: OutboundIntegrationStore;
    let savedMocks: ReturnType<OutboundIntegrationStore['installMocks']>;

    beforeEach(() => {
        store = new OutboundIntegrationStore();
        savedMocks = store.installMocks();
        _setOutboundDispatcherTestDeps({ suppressSchedule: true });
    });

    afterEach(() => {
        store.restoreMocks(savedMocks);
    });

    it('PROCESSING stale preserva pending mais recente e libera PENDING_UPDATE', async () => {
        const hash600 = hashOutboundPayload({
            ...baseInput,
            valorTotalCents: 60000,
        });
        const staleAt = new Date('2026-09-11T07:00:00.000Z');
        const now = new Date('2026-09-11T07:20:00.000Z');

        store.seedQueueRow({
            id_reserva_hospedagem: 15720,
            outbound_status: HospedinOutboundStatus.PROCESSING,
            desired_action: HospedinOutboundDesiredAction.UPDATE,
            payload_hash: hashOutboundPayload({
                ...baseInput,
                valorTotalCents: 90000,
            }),
            pending_payload_hash: hash600,
            hospedin_reservation_id: '30428400',
            processing_started_at: staleAt,
            processing_correlation_id: 'stale-corr',
        });

        const result = await hospedinOutboundStateService.recoverStaleProcessing(
            {
                now,
                staleMs: 10 * 60_000,
            }
        );

        assert.equal(result.recovered, 1);
        const after = store.getRowByReserva(15720)!;
        assert.equal(after.outbound_status, HospedinOutboundStatus.PENDING_UPDATE);
        assert.equal(after.pending_payload_hash, hash600);
        assert.equal(after.processing_started_at, null);
        assert.equal(
            resolvePendingOutboundStatus(HospedinOutboundDesiredAction.UPDATE),
            HospedinOutboundStatus.PENDING_UPDATE
        );
    });
});

describe('tryClaim — sem UPDATE concorrente', () => {
    let store: OutboundIntegrationStore;
    let savedMocks: ReturnType<OutboundIntegrationStore['installMocks']>;

    beforeEach(() => {
        store = new OutboundIntegrationStore();
        savedMocks = store.installMocks();
        _setOutboundDispatcherTestDeps({ suppressSchedule: true });
    });

    afterEach(() => {
        store.restoreMocks(savedMocks);
    });

    it('PROCESSING não é claimable; segundo claim falha', async () => {
        const row = store.seedQueueRow({
            id_reserva_hospedagem: 15730,
            outbound_status: HospedinOutboundStatus.PROCESSING,
            desired_action: HospedinOutboundDesiredAction.UPDATE,
            payload_hash: hashOutboundPayload({
                ...baseInput,
                valorTotalCents: 90000,
            }),
            pending_payload_hash: hashOutboundPayload({
                ...baseInput,
                valorTotalCents: 40000,
            }),
            hospedin_reservation_id: '30428400',
            processing_started_at: new Date(),
            processing_correlation_id: 'active-corr',
        });

        const secondClaim = await hospedinOutboundStateService.tryClaim(
            row.id,
            'corr-2'
        );

        assert.equal(secondClaim, false);
        assert.equal(
            store.getRowByReserva(15730)?.processing_correlation_id,
            'active-corr'
        );
    });
});
