/**
 * Testes de integração — pipeline outbound (has_pending + dispatcher + watchdog).
 * Sem HTTP Hospedin real; runner simulado via fakeRunProviderCycle.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { HospedinOutboundDesiredAction, HospedinOutboundStatus } from '../../../models/HospedinOutboundSyncState';
import { markDirty } from './HospedinOutboundEnqueueService';
import {
    _resetOutboundDispatcherForTests,
    _setOutboundDispatcherTestDeps,
    hospedinOutboundDispatcher,
} from './HospedinOutboundDispatcher';
import { OutboundIntegrationStore } from './OutboundIntegrationStore';
import { countClaimableOutbound } from './hospedinOutboundQueueProbe';

describe('HospedinOutbound — integração dispatcher', () => {
    let store: OutboundIntegrationStore;
    let savedMocks: ReturnType<OutboundIntegrationStore['installMocks']>;

    beforeEach(() => {
        store = new OutboundIntegrationStore();
        store.providerEnabled = true;
        savedMocks = store.installMocks();
    });

    afterEach(() => {
        store.restoreMocks(savedMocks);
    });

    it('1 — markDirty gera pendência, sinaliza has_pending e dispara dispatcher', async () => {
        store.seedReserva({ id: 9001 });

        _setOutboundDispatcherTestDeps({ suppressSchedule: true });
        await markDirty(9001);

        const rowAfterEnqueue = store.getRowByReserva(9001);
        assert.ok(rowAfterEnqueue);
        assert.equal(
            rowAfterEnqueue.outbound_status,
            HospedinOutboundStatus.PENDING_CREATE
        );
        assert.equal(store.hasPending, true);
        assert.equal(store.runCycleCalls.length, 0);

        _setOutboundDispatcherTestDeps({
            suppressSchedule: false,
            synchronousSchedule: true,
            runProviderCycle: store.fakeRunProviderCycle,
        });
        await hospedinOutboundDispatcher.dispatch('signal');

        assert.equal(store.getRowByReserva(9001)?.outbound_status, HospedinOutboundStatus.SYNCED);
        assert.equal(store.hasPending, false);
        assert.equal(store.runCycleCalls.length, 1);
    });

    it('2 — dispatcher chama runProviderCycle (runner simulado)', async () => {
        store.seedReserva({ id: 9002 });
        await markDirty(9002);

        assert.equal(store.runCycleCalls.length, 1);
        assert.equal(store.runCycleCalls[0].provider, 'HOSPEDIN_OUTBOUND');
        assert.equal(store.httpCalls, 1);
    });

    it('3 — após processamento has_pending=false e fila sem claimables', async () => {
        store.seedReserva({ id: 9003 });
        await markDirty(9003);

        assert.equal(await countClaimableOutbound(), 0);
        assert.equal(store.hasPending, false);
    });

    it('4 — duas alterações simultâneas: sem perda e sem dispatch concorrente', async () => {
        store.seedReserva({ id: 9101 });
        store.seedReserva({
            id: 9102,
            idExterno: '99999',
            ReservaSuite: [
                {
                    idEventoSuite: 4,
                    ReservaHospede: [{ nome: 'Outro Hospede' }],
                },
            ],
        });
        store.seedQueueRow({
            id_reserva_hospedagem: 9102,
            outbound_status: HospedinOutboundStatus.SYNCED,
            desired_action: HospedinOutboundDesiredAction.UPDATE,
            payload_hash: 'old-hash',
            pending_payload_hash: 'old-hash',
            hospedin_reservation_id: '99999',
        });

        await Promise.all([markDirty(9101), markDirty(9102)]);

        assert.equal(await countClaimableOutbound(), 0);
        assert.equal(store.hasPending, false);
        assert.equal(store.maxConcurrentDispatch, 1);
        assert.ok(store.runCycleCalls.length >= 1);
        assert.equal(
            store.getRowByReserva(9101)?.outbound_status,
            HospedinOutboundStatus.SYNCED
        );
        assert.equal(
            store.getRowByReserva(9102)?.outbound_status,
            HospedinOutboundStatus.SYNCED
        );
    });

    it('5 — race no clear: nova pendência durante clear não perde processamento', async () => {
        store.seedReserva({ id: 9201 });
        store.injectClaimableOnClear = () => {
            store.seedReserva({ id: 9202 });
            store.seedQueueRow({
                id_reserva_hospedagem: 9202,
                outbound_status: HospedinOutboundStatus.PENDING_CREATE,
                desired_action: HospedinOutboundDesiredAction.CREATE,
            });
            store.hasPending = true;
        };

        await markDirty(9201);

        assert.equal(store.getRowByReserva(9201)?.outbound_status, HospedinOutboundStatus.SYNCED);
        assert.equal(store.getRowByReserva(9202)?.outbound_status, HospedinOutboundStatus.SYNCED);
        assert.equal(await countClaimableOutbound(), 0);
        assert.equal(store.hasPending, false);
    });

    it('6 — falha no trigger: watchdog recupera pendência', async () => {
        _setOutboundDispatcherTestDeps({ suppressSchedule: true });

        store.seedReserva({ id: 9301 });
        await markDirty(9301);

        const row = store.getRowByReserva(9301);
        assert.equal(row?.outbound_status, HospedinOutboundStatus.PENDING_CREATE);
        assert.equal(store.hasPending, true);
        assert.equal(store.runCycleCalls.length, 0);

        store.hasPending = false;
        store.nextRunAt = null;

        _setOutboundDispatcherTestDeps({
            suppressSchedule: false,
            synchronousSchedule: true,
            runProviderCycle: store.fakeRunProviderCycle,
        });

        await hospedinOutboundDispatcher.runWatchdogIfDue();
        await new Promise<void>((r) => setImmediate(r));

        assert.equal(store.getRowByReserva(9301)?.outbound_status, HospedinOutboundStatus.SYNCED);
        assert.equal(await countClaimableOutbound(), 0);
        assert.equal(store.hasPending, false);
        assert.ok(store.runCycleCalls.length >= 1);
    });

    it('7 — restart: pendência persistida recuperada pelo watchdog', async () => {
        store.seedQueueRow({
            id_reserva_hospedagem: 9401,
            outbound_status: HospedinOutboundStatus.PENDING_UPDATE,
            desired_action: HospedinOutboundDesiredAction.UPDATE,
            hospedin_reservation_id: '88888',
        });
        store.hasPending = true;
        store.nextRunAt = null;

        _resetOutboundDispatcherForTests();
        _setOutboundDispatcherTestDeps({
            synchronousSchedule: true,
            suppressSchedule: false,
            runProviderCycle: store.fakeRunProviderCycle,
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
        });

        await hospedinOutboundDispatcher.runWatchdogIfDue();
        await new Promise<void>((r) => setImmediate(r));

        assert.equal(store.getRowByReserva(9401)?.outbound_status, HospedinOutboundStatus.SYNCED);
        assert.equal(store.hasPending, false);
    });

    it('8 — provider disabled: não dispara e pendência permanece', async () => {
        store.providerEnabled = false;
        store.seedReserva({ id: 9501 });

        await markDirty(9501);

        const row = store.getRowByReserva(9501);
        assert.equal(row?.outbound_status, HospedinOutboundStatus.PENDING_CREATE);
        assert.equal(store.hasPending, false);
        assert.equal(store.runCycleCalls.length, 0);
        assert.equal(store.httpCalls, 0);
        assert.equal(await countClaimableOutbound(), 1);
    });

    it('9 — provider enabled: alteração dispara por pendência sem polling', async () => {
        store.providerEnabled = true;
        store.seedReserva({ id: 9601 });

        const pollSpy = { schedulerTick: 0 };

        await markDirty(9601);

        assert.equal(pollSpy.schedulerTick, 0);
        assert.equal(store.runCycleCalls.length, 1);
        assert.equal(store.getRowByReserva(9601)?.outbound_status, HospedinOutboundStatus.SYNCED);
        assert.equal(store.hasPending, false);
    });
});
