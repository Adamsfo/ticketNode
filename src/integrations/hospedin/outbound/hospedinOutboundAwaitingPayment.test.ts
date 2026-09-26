/**
 * AguardandoPagamento — defer sem tight loop; markDirty após pagamento; expiração.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { StatusReservaHospedagem } from '../../../models/ReservaHospedagem';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundStatus,
} from '../../../models/HospedinOutboundSyncState';
import { HospedinOutboundCreateService } from './HospedinOutboundCreateService';
import { markDirty } from './HospedinOutboundEnqueueService';
import {
    _resetOutboundDispatcherForTests,
    _setOutboundDispatcherTestDeps,
    hospedinOutboundDispatcher,
} from './HospedinOutboundDispatcher';
import { countClaimableOutbound } from './hospedinOutboundQueueProbe';
import {
    hospedinOutboundStateService,
    resolveAwaitingPaymentNextRetryAt,
} from './HospedinOutboundStateService';
import { OutboundIntegrationStore } from './OutboundIntegrationStore';

describe('resolveAwaitingPaymentNextRetryAt', () => {
    it('usa expiraEm quando futuro', () => {
        const now = new Date('2026-09-26T12:00:00.000Z');
        const expiraEm = new Date('2026-09-26T14:00:00.000Z');
        const next = resolveAwaitingPaymentNextRetryAt(expiraEm, now);
        assert.equal(next.getTime(), expiraEm.getTime());
    });

    it('fallback quando expiraEm ausente ou passado', () => {
        const now = new Date('2026-09-26T12:00:00.000Z');
        const next = resolveAwaitingPaymentNextRetryAt(null, now);
        assert.ok(next.getTime() > now.getTime());
        assert.ok(next.getTime() <= now.getTime() + 5 * 60 * 1000 + 1000);
    });
});

describe('AguardandoPagamento — CREATE deferred', () => {
    let store: OutboundIntegrationStore;
    let savedMocks: ReturnType<OutboundIntegrationStore['installMocks']>;

    beforeEach(() => {
        store = new OutboundIntegrationStore();
        savedMocks = store.installMocks();
    });

    afterEach(() => {
        store.restoreMocks(savedMocks);
        _resetOutboundDispatcherForTests();
    });

    it('deferred agenda next_retry_at e não permanece claimable', async () => {
        const expiraEm = new Date(Date.now() + 60 * 60 * 1000);
        _setOutboundDispatcherTestDeps({ suppressSchedule: true });
        store.seedReserva({
            id: 9701,
            status: StatusReservaHospedagem.AguardandoPagamento,
            expiraEm,
        } as any);
        store.seedQueueRow({
            id_reserva_hospedagem: 9701,
            outbound_status: HospedinOutboundStatus.PENDING_CREATE,
            desired_action: HospedinOutboundDesiredAction.CREATE,
        });

        const row = store.getRowByReserva(9701);
        assert.ok(row);

        const service = new HospedinOutboundCreateService();
        const claimed = await hospedinOutboundStateService.tryClaim(
            row.id,
            'test-awaiting'
        );
        assert.equal(claimed, true);

        const result = await service.create({
            id: row.id,
            id_reserva_hospedagem: 9701,
            desired_action: HospedinOutboundDesiredAction.CREATE,
        } as any);

        assert.equal(result.outcome, 'deferred');
        assert.equal(result.errorCode, 'AWAITING_PAYMENT');

        const after = store.getRowByReserva(9701)!;
        assert.equal(after.outbound_status, HospedinOutboundStatus.PENDING_CREATE);
        assert.equal(
            after.desired_action,
            HospedinOutboundDesiredAction.CREATE
        );
        assert.ok(after.next_retry_at);
        assert.ok(after.next_retry_at!.getTime() >= expiraEm.getTime() - 1000);
        assert.equal(after.error_code, 'AWAITING_PAYMENT');

        assert.equal(await countClaimableOutbound(), 0);
    });
});

describe('AguardandoPagamento — dispatcher não dispara centenas de ciclos', () => {
    let store: OutboundIntegrationStore;
    let savedMocks: ReturnType<OutboundIntegrationStore['installMocks']>;

    beforeEach(() => {
        store = new OutboundIntegrationStore();
        store.providerEnabled = true;
        savedMocks = store.installMocks();
    });

    afterEach(() => {
        store.restoreMocks(savedMocks);
        _resetOutboundDispatcherForTests();
    });

    it('após defer, drain encerra com poucos runProviderCycle', async () => {
        _setOutboundDispatcherTestDeps({ suppressSchedule: true });
        store.seedReserva({
            id: 9702,
            status: StatusReservaHospedagem.AguardandoPagamento,
            expiraEm: new Date(Date.now() + 60 * 60 * 1000),
        } as any);
        store.seedQueueRow({
            id_reserva_hospedagem: 9702,
            outbound_status: HospedinOutboundStatus.PENDING_CREATE,
            desired_action: HospedinOutboundDesiredAction.CREATE,
        });
        store.hasPending = true;

        let runCycles = 0;
        _setOutboundDispatcherTestDeps({
            suppressSchedule: false,
            synchronousSchedule: true,
            getProviderScheduleConfig: async () => ({
                enabled: true,
                intervalMinutes: 15,
                mode: 'incremental',
                syncLimit: 30,
                priority: 110,
                maxRetries: 5,
                backoffBaseSeconds: 30,
                maxRunMinutes: 10,
                webhookEnabled: false,
                displayName: 'Hospedin Outbound',
            }),
            runProviderCycle: async () => {
                runCycles += 1;
                const row = store.getRowByReserva(9702);
                if (!row) {
                    return {
                        skipped: true,
                        correlationId: 't',
                        reason: 'no row',
                    };
                }
                const due = await hospedinOutboundStateService.listDue(1);
                if (!due.length) {
                    return {
                        skipped: true,
                        correlationId: 't',
                        reason: 'no due',
                    };
                }
                const claimed = await hospedinOutboundStateService.tryClaim(
                    due[0].id,
                    'drain-test'
                );
                if (!claimed) {
                    return {
                        skipped: false,
                        correlationId: 't',
                        summary: {
                            ok: true,
                            created: 0,
                            updated: 0,
                            cancelled: 0,
                            failed: 0,
                            skipped: 1,
                        },
                    };
                }
                const service = new HospedinOutboundCreateService();
                await service.create(due[0] as any);
                return {
                    skipped: false,
                    correlationId: 't',
                    summary: {
                        ok: true,
                        created: 0,
                        updated: 0,
                        cancelled: 0,
                        failed: 0,
                        skipped: 1,
                    },
                };
            },
        });

        await hospedinOutboundDispatcher.dispatch('signal');

        assert.ok(runCycles <= 2, `runCycles=${runCycles}`);
        assert.equal(await countClaimableOutbound(), 0);
    });
});

describe('markDirty após pagamento (Confirmada)', () => {
    let store: OutboundIntegrationStore;
    let savedMocks: ReturnType<OutboundIntegrationStore['installMocks']>;

    beforeEach(() => {
        store = new OutboundIntegrationStore();
        savedMocks = store.installMocks();
    });

    afterEach(() => {
        store.restoreMocks(savedMocks);
    });

    it('limpa next_retry_at e mantém claimable', async () => {
        const expiraEm = new Date(Date.now() + 60 * 60 * 1000);
        _setOutboundDispatcherTestDeps({ suppressSchedule: true });
        store.seedReserva({
            id: 9703,
            status: StatusReservaHospedagem.AguardandoPagamento,
            expiraEm,
        } as any);
        store.seedQueueRow({
            id_reserva_hospedagem: 9703,
            outbound_status: HospedinOutboundStatus.PENDING_CREATE,
            desired_action: HospedinOutboundDesiredAction.CREATE,
        });

        const row = store.getRowByReserva(9703)!;
        await hospedinOutboundStateService.releaseAwaitingPayment(row.id, {
            desiredAction: HospedinOutboundDesiredAction.CREATE,
            expiraEm,
        });
        assert.ok(row.next_retry_at);

        const reserva = store.reservas.get(9703)!;
        reserva.status = StatusReservaHospedagem.Confirmada;

        _setOutboundDispatcherTestDeps({ suppressSchedule: true });
        await markDirty(9703);

        const after = store.getRowByReserva(9703)!;
        assert.equal(after.next_retry_at, null);
        assert.equal(after.outbound_status, HospedinOutboundStatus.PENDING_CREATE);
        assert.ok(await countClaimableOutbound() >= 1);
    });
});

describe('abortOutboundForExpiredReserva', () => {
    let store: OutboundIntegrationStore;
    let savedMocks: ReturnType<OutboundIntegrationStore['installMocks']>;

    beforeEach(() => {
        store = new OutboundIntegrationStore();
        savedMocks = store.installMocks();
    });

    afterEach(() => {
        store.restoreMocks(savedMocks);
    });

    it('ABORTED + STATUS_TERMINAL e não claimable', async () => {
        store.seedReserva({
            id: 9704,
            status: StatusReservaHospedagem.Expirada,
        });
        store.seedQueueRow({
            id_reserva_hospedagem: 9704,
            outbound_status: HospedinOutboundStatus.PENDING_CREATE,
            desired_action: HospedinOutboundDesiredAction.CREATE,
            next_retry_at: new Date(Date.now() + 60 * 60 * 1000),
        });

        await hospedinOutboundStateService.abortOutboundForExpiredReserva(9704);

        const row = store.getRowByReserva(9704)!;
        assert.equal(row.outbound_status, HospedinOutboundStatus.ABORTED);
        assert.equal(row.error_code, 'STATUS_TERMINAL');
        assert.equal(await countClaimableOutbound(), 0);
    });
});
