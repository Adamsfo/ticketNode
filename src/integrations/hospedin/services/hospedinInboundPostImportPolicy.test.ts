import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IntegrationSyncTrigger } from '../../../models/IntegrationSyncExecution';
import {
    resolveInboundWorkFoundAfterPreflight,
    shouldOmitInboundExecutionAfterPreflight,
} from './hospedinInboundPostImportPolicy';

describe('shouldOmitInboundExecutionAfterPreflight', () => {
    const scheduler = IntegrationSyncTrigger.SCHEDULER;

    it('1 — reserva futura NOVA (importWorkFound) → não omite execution', () => {
        assert.equal(
            shouldOmitInboundExecutionAfterPreflight({
                trigger: scheduler,
                mode: 'incremental',
                importWorkFound: true,
                hasPendingFutureSync: false,
            }),
            false
        );
    });

    it('2 — reserva futura ALTERADA → não omite execution', () => {
        assert.equal(
            shouldOmitInboundExecutionAfterPreflight({
                trigger: scheduler,
                mode: 'incremental',
                importWorkFound: true,
                hasPendingFutureSync: false,
            }),
            false
        );
    });

    it('3 — reserva futura INALTERADA no arquivo, sem sync pendente → omite', () => {
        assert.equal(
            shouldOmitInboundExecutionAfterPreflight({
                trigger: scheduler,
                mode: 'incremental',
                importWorkFound: false,
                hasPendingFutureSync: false,
            }),
            true
        );
    });

    it('4 — arquivo somente passadas (sem work no import) → omite', () => {
        assert.equal(
            shouldOmitInboundExecutionAfterPreflight({
                trigger: scheduler,
                mode: 'incremental',
                importWorkFound: false,
                hasPendingFutureSync: false,
            }),
            true
        );
    });

    it('5 — staging antiga + arquivo futuro inalterado → omite (não usa remaining)', () => {
        assert.equal(
            shouldOmitInboundExecutionAfterPreflight({
                trigger: scheduler,
                mode: 'incremental',
                importWorkFound: false,
                hasPendingFutureSync: false,
            }),
            true
        );
    });

    it('6 — sync pendente futuro existente → não omite mesmo sem mudança no arquivo', () => {
        assert.equal(
            shouldOmitInboundExecutionAfterPreflight({
                trigger: scheduler,
                mode: 'incremental',
                importWorkFound: false,
                hasPendingFutureSync: true,
            }),
            false
        );
    });

    it('manual sempre registra execution', () => {
        assert.equal(
            shouldOmitInboundExecutionAfterPreflight({
                trigger: IntegrationSyncTrigger.MANUAL,
                mode: 'incremental',
                importWorkFound: false,
                hasPendingFutureSync: false,
            }),
            false
        );
    });

    it('mode full no scheduler não omite por política', () => {
        assert.equal(
            shouldOmitInboundExecutionAfterPreflight({
                trigger: scheduler,
                mode: 'full',
                importWorkFound: false,
                hasPendingFutureSync: false,
            }),
            false
        );
    });
});

describe('resolveInboundWorkFoundAfterPreflight', () => {
    it('workFound = importWorkFound OR pending sync', () => {
        assert.equal(
            resolveInboundWorkFoundAfterPreflight({
                importWorkFound: false,
                hasPendingFutureSync: true,
            }),
            true
        );
        assert.equal(
            resolveInboundWorkFoundAfterPreflight({
                importWorkFound: true,
                hasPendingFutureSync: false,
            }),
            true
        );
        assert.equal(
            resolveInboundWorkFoundAfterPreflight({
                importWorkFound: false,
                hasPendingFutureSync: false,
            }),
            false
        );
    });
});
