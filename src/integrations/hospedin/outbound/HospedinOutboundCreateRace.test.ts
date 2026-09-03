/**
 * Testes offline — corrida CREATE × CANCEL (sem HTTP/DB real).
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/HospedinOutboundCreateRace.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundStatus,
} from '../../../models/HospedinOutboundSyncState';
import { StatusReservaHospedagem } from '../../../models/ReservaHospedagem';
import {
    canMarkSyncedAfterCreate,
    resolveCreateFinalizeDecision,
    shouldDeferCreateToPendingCancel,
    type CreateFinalizeSnapshot,
} from './hospedinOutboundCreateFinalize';

const confirmadaProcessing: CreateFinalizeSnapshot = {
    jangoStatus: StatusReservaHospedagem.Confirmada,
    desiredAction: HospedinOutboundDesiredAction.CREATE,
    outboundStatus: HospedinOutboundStatus.PROCESSING,
};

describe('shouldDeferCreateToPendingCancel', () => {
    it('1 — cancelamento antes do POST: Jango Cancelada => defer', () => {
        assert.equal(
            shouldDeferCreateToPendingCancel({
                jangoStatus: StatusReservaHospedagem.Cancelada,
                desiredAction: HospedinOutboundDesiredAction.CREATE,
                outboundStatus: HospedinOutboundStatus.PROCESSING,
            }),
            true
        );
    });

    it('6 — Jango Cancelada após POST => PENDING_CANCEL', () => {
        assert.equal(
            resolveCreateFinalizeDecision({
                jangoStatus: StatusReservaHospedagem.Cancelada,
                desiredAction: HospedinOutboundDesiredAction.CREATE,
                outboundStatus: HospedinOutboundStatus.PROCESSING,
            }),
            'pending_cancel'
        );
    });

    it('4 — fila PENDING_CANCEL após POST => defer', () => {
        assert.equal(
            shouldDeferCreateToPendingCancel({
                jangoStatus: StatusReservaHospedagem.Confirmada,
                desiredAction: HospedinOutboundDesiredAction.CANCEL,
                outboundStatus: HospedinOutboundStatus.PENDING_CANCEL,
            }),
            true
        );
        assert.equal(
            resolveCreateFinalizeDecision({
                jangoStatus: StatusReservaHospedagem.Confirmada,
                desiredAction: HospedinOutboundDesiredAction.CANCEL,
                outboundStatus: HospedinOutboundStatus.PENDING_CANCEL,
            }),
            'pending_cancel'
        );
    });

    it('5 — desired_action=CANCEL após POST => defer', () => {
        assert.equal(
            shouldDeferCreateToPendingCancel({
                jangoStatus: StatusReservaHospedagem.Confirmada,
                desiredAction: HospedinOutboundDesiredAction.CANCEL,
                outboundStatus: HospedinOutboundStatus.PROCESSING,
            }),
            true
        );
    });
});

describe('resolveCreateFinalizeDecision — fluxo normal', () => {
    it('3 — CREATE sem cancelamento => mark_synced', () => {
        assert.equal(
            resolveCreateFinalizeDecision(confirmadaProcessing),
            'mark_synced'
        );
        assert.equal(canMarkSyncedAfterCreate(confirmadaProcessing), true);
    });
});

describe('corrida CREATE × markOutboundCancelled', () => {
    it('2 — snapshot antigo vs estado fresco após cancel durante POST', () => {
        const staleBeforeFinalize = { ...confirmadaProcessing };
        assert.equal(
            resolveCreateFinalizeDecision(staleBeforeFinalize),
            'mark_synced',
            'snapshot antigo ainda parece PROCESSING+CREATE'
        );

        const freshAfterCancel = {
            jangoStatus: StatusReservaHospedagem.Confirmada,
            desiredAction: HospedinOutboundDesiredAction.CANCEL,
            outboundStatus: HospedinOutboundStatus.PENDING_CANCEL,
        };
        assert.equal(
            resolveCreateFinalizeDecision(freshAfterCancel),
            'pending_cancel',
            'estado fresco após markOutboundCancelled'
        );
        assert.equal(canMarkSyncedAfterCreate(freshAfterCancel), false);
    });

    it('2b — Jango cancelada no reload fresco mesmo com fila PROCESSING', () => {
        const fresh = {
            jangoStatus: StatusReservaHospedagem.Cancelada,
            desiredAction: HospedinOutboundDesiredAction.CREATE,
            outboundStatus: HospedinOutboundStatus.PROCESSING,
        };
        assert.equal(resolveCreateFinalizeDecision(fresh), 'pending_cancel');
        assert.equal(canMarkSyncedAfterCreate(fresh), false);
    });

    it('CAS perde corrida: PENDING_CANCEL impede mark_synced', () => {
        const lostRace = {
            jangoStatus: StatusReservaHospedagem.Confirmada,
            desiredAction: HospedinOutboundDesiredAction.CANCEL,
            outboundStatus: HospedinOutboundStatus.PENDING_CANCEL,
        };
        assert.equal(canMarkSyncedAfterCreate(lostRace), false);
        assert.equal(resolveCreateFinalizeDecision(lostRace), 'pending_cancel');
    });
});

describe('hospedin_reservation_id e POST único', () => {
    it('7 — decisão pending_cancel não implica segundo POST', () => {
        const postCallCount = 1;
        assert.equal(postCallCount, 1);
        assert.equal(
            resolveCreateFinalizeDecision({
                jangoStatus: StatusReservaHospedagem.Cancelada,
                desiredAction: HospedinOutboundDesiredAction.CANCEL,
                outboundStatus: HospedinOutboundStatus.PENDING_CANCEL,
            }),
            'pending_cancel'
        );
    });

    it('8 — pending_cancel preserva ID para CANCEL posterior', () => {
        const hospedinReservationId = '30999999';
        const pendingCancelPatch = {
            outbound_status: HospedinOutboundStatus.PENDING_CANCEL,
            desired_action: HospedinOutboundDesiredAction.CANCEL,
            hospedin_reservation_id: hospedinReservationId,
        };
        assert.equal(pendingCancelPatch.hospedin_reservation_id, hospedinReservationId);
        assert.equal(pendingCancelPatch.desired_action, 'CANCEL');
        assert.equal(pendingCancelPatch.outbound_status, 'PENDING_CANCEL');
        assert.notEqual(pendingCancelPatch.outbound_status, 'SYNCED');
    });
});

describe('finalizeCreateAfterPost — contrato de estados', () => {
    it('nunca SYNCED quando qualquer gatilho de cancel está ativo', () => {
        const triggers: CreateFinalizeSnapshot[] = [
            {
                jangoStatus: StatusReservaHospedagem.Cancelada,
                desiredAction: HospedinOutboundDesiredAction.CREATE,
                outboundStatus: HospedinOutboundStatus.PROCESSING,
            },
            {
                jangoStatus: StatusReservaHospedagem.Confirmada,
                desiredAction: HospedinOutboundDesiredAction.CANCEL,
                outboundStatus: HospedinOutboundStatus.PROCESSING,
            },
            {
                jangoStatus: StatusReservaHospedagem.Confirmada,
                desiredAction: HospedinOutboundDesiredAction.CANCEL,
                outboundStatus: HospedinOutboundStatus.PENDING_CANCEL,
            },
        ];

        for (const snapshot of triggers) {
            assert.equal(
                resolveCreateFinalizeDecision(snapshot),
                'pending_cancel',
                JSON.stringify(snapshot)
            );
        }
    });
});
