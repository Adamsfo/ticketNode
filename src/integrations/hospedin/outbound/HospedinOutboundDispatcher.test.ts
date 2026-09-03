import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HospedinOutboundStatus } from '../../../models/HospedinOutboundSyncState';
import {
    isOutboundClaimableStatus,
    OUTBOUND_CLAIMABLE_STATUSES,
} from './hospedinOutboundClaimable';
import {
    _resetOutboundDispatcherForTests,
    hospedinOutboundDispatcher,
} from './HospedinOutboundDispatcher';

describe('hospedinOutboundClaimable', () => {
    it('lista claimable oficial', () => {
        assert.deepEqual(OUTBOUND_CLAIMABLE_STATUSES, [
            'PENDING_CREATE',
            'PENDING_UPDATE',
            'PENDING_CANCEL',
            'WAIT_RETRY',
        ]);
    });

    it('ABORTED e SYNCED não são claimable', () => {
        assert.equal(isOutboundClaimableStatus(HospedinOutboundStatus.ABORTED), false);
        assert.equal(isOutboundClaimableStatus(HospedinOutboundStatus.SYNCED), false);
        assert.equal(isOutboundClaimableStatus(HospedinOutboundStatus.BLOCKED), false);
        assert.equal(isOutboundClaimableStatus(HospedinOutboundStatus.FAILED), false);
        assert.equal(isOutboundClaimableStatus(HospedinOutboundStatus.PROCESSING), false);
    });

    it('pendências são claimable', () => {
        assert.equal(isOutboundClaimableStatus('PENDING_CREATE'), true);
        assert.equal(isOutboundClaimableStatus('pending_update'), true);
        assert.equal(isOutboundClaimableStatus('WAIT_RETRY'), true);
    });
});

describe('HospedinOutboundDispatcher — mutex local', () => {
    it('inicia sem execução em andamento', () => {
        _resetOutboundDispatcherForTests();
        assert.equal(hospedinOutboundDispatcher.isDispatchRunning(), false);
    });
});
