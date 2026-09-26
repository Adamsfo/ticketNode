import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundStatus,
} from '../../../models/HospedinOutboundSyncState';
import { OutboundIntegrationStore } from './OutboundIntegrationStore';

describe('tryClearOutboundPendingIfIdle (store mirror)', () => {
    const refNow = new Date();
    const pastCheckin = new Date(refNow.getTime() - 30 * 24 * 60 * 60 * 1000);
    const pastCheckout = new Date(refNow.getTime() - 28 * 24 * 60 * 60 * 1000);
    const futureCheckin = new Date(refNow.getTime() + 30 * 24 * 60 * 60 * 1000);
    const futureCheckout = new Date(refNow.getTime() + 32 * 24 * 60 * 60 * 1000);

    it('somente PENDING_CREATE inelegível → ABORTED e has_pending=0', async () => {
        const store = new OutboundIntegrationStore();
        store.hasPending = true;
        store.seedReserva({
            id: 8001,
            checkin: pastCheckin,
            checkout: pastCheckout,
        });
        store.seedQueueRow({
            id_reserva_hospedagem: 8001,
            outbound_status: HospedinOutboundStatus.PENDING_CREATE,
            desired_action: HospedinOutboundDesiredAction.CREATE,
        });
        const cleared = await store.tryClearOutboundPendingIfIdle();
        assert.equal(cleared, true);
        assert.equal(store.hasPending, false);
        assert.equal(
            store.getRowByReserva(8001)?.outbound_status,
            HospedinOutboundStatus.ABORTED
        );
    });

    it('somente PENDING_UPDATE inelegível → ABORTED', async () => {
        const store = new OutboundIntegrationStore();
        store.hasPending = true;
        store.seedReserva({
            id: 8002,
            checkin: pastCheckin,
            checkout: pastCheckout,
        });
        store.seedQueueRow({
            id_reserva_hospedagem: 8002,
            outbound_status: HospedinOutboundStatus.PENDING_UPDATE,
            desired_action: HospedinOutboundDesiredAction.UPDATE,
        });
        await store.tryClearOutboundPendingIfIdle();
        assert.equal(
            store.getRowByReserva(8002)?.outbound_status,
            HospedinOutboundStatus.ABORTED
        );
    });

    it('somente PENDING_CANCEL (passado) → elegível, não clear', async () => {
        const store = new OutboundIntegrationStore();
        store.hasPending = true;
        store.seedReserva({
            id: 8003,
            checkin: pastCheckin,
            checkout: pastCheckout,
        });
        store.seedQueueRow({
            id_reserva_hospedagem: 8003,
            outbound_status: HospedinOutboundStatus.PENDING_CANCEL,
            desired_action: HospedinOutboundDesiredAction.CANCEL,
        });
        const cleared = await store.tryClearOutboundPendingIfIdle();
        assert.equal(cleared, false);
        assert.equal(store.hasPending, true);
        assert.equal(
            store.getRowByReserva(8003)?.outbound_status,
            HospedinOutboundStatus.PENDING_CANCEL
        );
    });

    it('mistura elegível + inelegível → não clear; inelegível permanece até fila elegível zerar', async () => {
        const store = new OutboundIntegrationStore();
        store.hasPending = true;
        store.seedReserva({ id: 8010, checkin: futureCheckin, checkout: futureCheckout });
        store.seedReserva({ id: 8011, checkin: pastCheckin, checkout: pastCheckout });
        store.seedQueueRow({
            id_reserva_hospedagem: 8010,
            outbound_status: HospedinOutboundStatus.PENDING_CREATE,
            desired_action: HospedinOutboundDesiredAction.CREATE,
        });
        store.seedQueueRow({
            id_reserva_hospedagem: 8011,
            outbound_status: HospedinOutboundStatus.PENDING_CREATE,
            desired_action: HospedinOutboundDesiredAction.CREATE,
        });
        const cleared = await store.tryClearOutboundPendingIfIdle();
        assert.equal(cleared, false);
        assert.equal(
            store.getRowByReserva(8011)?.outbound_status,
            HospedinOutboundStatus.PENDING_CREATE
        );
        assert.equal(
            store.getRowByReserva(8010)?.outbound_status,
            HospedinOutboundStatus.PENDING_CREATE
        );
        assert.equal(store.hasPending, true);
    });

    it('nenhum PENDING → clear normal', async () => {
        const store = new OutboundIntegrationStore();
        store.hasPending = true;
        const cleared = await store.tryClearOutboundPendingIfIdle();
        assert.equal(cleared, true);
        assert.equal(store.hasPending, false);
    });

    it('WAIT_RETRY futuro due → não clear (elegível)', async () => {
        const store = new OutboundIntegrationStore();
        store.hasPending = true;
        store.seedReserva({ id: 8020, checkin: futureCheckin, checkout: futureCheckout });
        store.seedQueueRow({
            id_reserva_hospedagem: 8020,
            outbound_status: HospedinOutboundStatus.WAIT_RETRY,
            desired_action: HospedinOutboundDesiredAction.CREATE,
            next_retry_at: new Date(refNow.getTime() - 60_000),
        });
        const cleared = await store.tryClearOutboundPendingIfIdle();
        assert.equal(cleared, false);
    });

    it('após abandon só inelegíveis, sem loop: uma passagem zera órfãos', async () => {
        const store = new OutboundIntegrationStore();
        store.hasPending = true;
        for (let i = 0; i < 5; i += 1) {
            const id = 8030 + i;
            store.seedReserva({ id, checkin: pastCheckin, checkout: pastCheckout });
            store.seedQueueRow({
                id_reserva_hospedagem: id,
                outbound_status: HospedinOutboundStatus.PENDING_CREATE,
                desired_action: HospedinOutboundDesiredAction.CREATE,
            });
        }
        const cleared = await store.tryClearOutboundPendingIfIdle();
        assert.equal(cleared, true);
        assert.equal(store.countRawClaimableInStore(), 0);
    });
});
