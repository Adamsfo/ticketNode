/**
 * ABORTED / OUTBOUND_OPERATIONAL_WINDOW — reenfileiramento via markDirty.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { StatusReservaHospedagem } from '../../../models/ReservaHospedagem';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundStatus,
    HospedinOutboundSyncState,
} from '../../../models/HospedinOutboundSyncState';
import { _setOutboundDispatcherTestDeps } from './HospedinOutboundDispatcher';
import {
    markDirty,
    outboundEnqueueTestHelpers,
} from './HospedinOutboundEnqueueService';
import { hospedinOutboundStateService } from './HospedinOutboundStateService';
import { OutboundIntegrationStore } from './OutboundIntegrationStore';

describe('shouldSkipMarkDirty — OUTBOUND_OPERATIONAL_WINDOW', () => {
    it('3 — ABORTED / STATUS_TERMINAL + Expirada continua skip', () => {
        assert.equal(
            outboundEnqueueTestHelpers.shouldSkipMarkDirty(
                { status: StatusReservaHospedagem.Expirada } as any,
                {
                    outbound_status: HospedinOutboundStatus.ABORTED,
                    error_code: 'STATUS_TERMINAL',
                } as any
            ),
            true
        );
    });

    it('4 — ABORTED / OUTBOUND_OPERATIONAL_WINDOW não bloqueia skip', () => {
        assert.equal(
            outboundEnqueueTestHelpers.shouldSkipMarkDirty(
                { status: StatusReservaHospedagem.Confirmada } as any,
                {
                    outbound_status: HospedinOutboundStatus.ABORTED,
                    error_code: 'OUTBOUND_OPERATIONAL_WINDOW',
                    desired_action: HospedinOutboundDesiredAction.CREATE,
                } as any
            ),
            false
        );
    });
});

describe('markAborted — desired_action', () => {
    let originalFindByPk: typeof HospedinOutboundSyncState.findByPk;
    let lastUpdate: Record<string, unknown> | null;
    let rowSnapshot: {
        desired_action: string;
        update: (patch: Record<string, unknown>) => Promise<unknown>;
    };

    beforeEach(() => {
        lastUpdate = null;
        rowSnapshot = {
            desired_action: HospedinOutboundDesiredAction.CREATE,
            update: async (patch: Record<string, unknown>) => {
                lastUpdate = patch;
                if (patch.desired_action != null) {
                    rowSnapshot.desired_action = String(patch.desired_action);
                }
                return rowSnapshot;
            },
        };
        originalFindByPk = HospedinOutboundSyncState.findByPk;
        HospedinOutboundSyncState.findByPk = (async () =>
            rowSnapshot as any) as typeof HospedinOutboundSyncState.findByPk;
    });

    afterEach(() => {
        HospedinOutboundSyncState.findByPk = originalFindByPk;
    });

    it('6a — OUTBOUND_OPERATIONAL_WINDOW preserva CREATE', async () => {
        rowSnapshot.desired_action = HospedinOutboundDesiredAction.CREATE;
        await hospedinOutboundStateService.markAborted(1, {
            errorCode: 'OUTBOUND_OPERATIONAL_WINDOW',
            errorMessage: 'janela',
        });
        assert.equal(lastUpdate?.error_code, 'OUTBOUND_OPERATIONAL_WINDOW');
        assert.equal(lastUpdate?.desired_action, undefined);
        assert.equal(rowSnapshot.desired_action, HospedinOutboundDesiredAction.CREATE);
    });

    it('6b — OUTBOUND_OPERATIONAL_WINDOW preserva UPDATE', async () => {
        rowSnapshot.desired_action = HospedinOutboundDesiredAction.UPDATE;
        await hospedinOutboundStateService.markAborted(1, {
            errorCode: 'OUTBOUND_OPERATIONAL_WINDOW',
        });
        assert.equal(lastUpdate?.desired_action, undefined);
        assert.equal(rowSnapshot.desired_action, HospedinOutboundDesiredAction.UPDATE);
    });

    it('6c — CREATE_ABORTED continua forçando CANCEL', async () => {
        rowSnapshot.desired_action = HospedinOutboundDesiredAction.CREATE;
        await hospedinOutboundStateService.markAborted(1, {
            errorCode: 'CREATE_ABORTED',
        });
        assert.equal(
            lastUpdate?.desired_action,
            HospedinOutboundDesiredAction.CANCEL
        );
    });
});

describe('markDirty após abandon operacional (store)', () => {
    let store: OutboundIntegrationStore;
    let savedMocks: ReturnType<OutboundIntegrationStore['installMocks']>;

    const refNow = new Date();
    const pastCheckin = new Date(refNow.getTime() - 30 * 24 * 60 * 60 * 1000);
    const pastCheckout = new Date(refNow.getTime() - 28 * 24 * 60 * 60 * 1000);
    const futureCheckin = new Date(refNow.getTime() + 30 * 24 * 60 * 60 * 1000);
    const futureCheckout = new Date(refNow.getTime() + 32 * 24 * 60 * 60 * 1000);

    beforeEach(() => {
        store = new OutboundIntegrationStore();
        savedMocks = store.installMocks();
        _setOutboundDispatcherTestDeps({ suppressSchedule: true });
    });

    afterEach(() => {
        store.restoreMocks(savedMocks);
    });

    it('1 — PENDING_CREATE abandonado → markDirty elegível → PENDING_CREATE', async () => {
        const id = 17001;
        store.seedReserva({
            id,
            checkin: pastCheckin,
            checkout: pastCheckout,
            idExterno: null,
        });
        store.seedQueueRow({
            id_reserva_hospedagem: id,
            outbound_status: HospedinOutboundStatus.PENDING_CREATE,
            desired_action: HospedinOutboundDesiredAction.CREATE,
        });
        store.abandonIneligibleInStore();
        let row = store.getRowByReserva(id)!;
        assert.equal(row.outbound_status, HospedinOutboundStatus.ABORTED);
        assert.equal(row.error_code, 'OUTBOUND_OPERATIONAL_WINDOW');
        assert.equal(row.desired_action, HospedinOutboundDesiredAction.CREATE);

        const reserva = store.reservas.get(id)!;
        reserva.checkin = futureCheckin;
        reserva.checkout = futureCheckout;

        await markDirty(id);
        row = store.getRowByReserva(id)!;
        assert.equal(row.outbound_status, HospedinOutboundStatus.PENDING_CREATE);
        assert.equal(row.desired_action, HospedinOutboundDesiredAction.CREATE);
        assert.equal(row.error_code, null);
    });

    it('2 — PENDING_UPDATE abandonado → markDirty elegível → PENDING_UPDATE', async () => {
        const id = 17002;
        store.seedReserva({
            id,
            checkin: pastCheckin,
            checkout: pastCheckout,
            idExterno: 'hosp-99',
        });
        store.seedQueueRow({
            id_reserva_hospedagem: id,
            outbound_status: HospedinOutboundStatus.PENDING_UPDATE,
            desired_action: HospedinOutboundDesiredAction.UPDATE,
            hospedin_reservation_id: 'hosp-99',
        });
        store.abandonIneligibleInStore();
        const reserva = store.reservas.get(id)!;
        reserva.checkout = futureCheckout;

        await markDirty(id);
        const row = store.getRowByReserva(id)!;
        assert.equal(row.outbound_status, HospedinOutboundStatus.PENDING_UPDATE);
        assert.equal(row.desired_action, HospedinOutboundDesiredAction.UPDATE);
    });

    it('4b — ABORTED operacional + alteração ainda inelegível → permanece ABORTED', async () => {
        const id = 17003;
        store.seedReserva({
            id,
            checkin: pastCheckin,
            checkout: pastCheckout,
            idExterno: null,
        });
        store.seedQueueRow({
            id_reserva_hospedagem: id,
            outbound_status: HospedinOutboundStatus.ABORTED,
            desired_action: HospedinOutboundDesiredAction.CREATE,
            error_code: 'OUTBOUND_OPERATIONAL_WINDOW',
        });
        await markDirty(id);
        const row = store.getRowByReserva(id)!;
        assert.equal(row.outbound_status, HospedinOutboundStatus.ABORTED);
        assert.equal(row.error_code, 'OUTBOUND_OPERATIONAL_WINDOW');
    });

    it('5 — PENDING_CANCEL não é abandonado por janela', () => {
        const id = 17004;
        store.seedReserva({
            id,
            checkin: pastCheckin,
            checkout: pastCheckout,
        });
        store.seedQueueRow({
            id_reserva_hospedagem: id,
            outbound_status: HospedinOutboundStatus.PENDING_CANCEL,
            desired_action: HospedinOutboundDesiredAction.CANCEL,
        });
        store.abandonIneligibleInStore();
        const row = store.getRowByReserva(id)!;
        assert.equal(row.outbound_status, HospedinOutboundStatus.PENDING_CANCEL);
        assert.equal(row.desired_action, HospedinOutboundDesiredAction.CANCEL);
    });
});
