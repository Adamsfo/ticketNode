import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { resolveIntegrationSyncExecutionRetentionDays } from './integrationSyncExecutionRetentionJob';

describe('resolveIntegrationSyncExecutionRetentionDays', () => {
    const prev = process.env.INTEGRATION_SYNC_EXECUTION_RETENTION_DAYS;

    beforeEach(() => {
        delete process.env.INTEGRATION_SYNC_EXECUTION_RETENTION_DAYS;
    });

    afterEach(() => {
        if (prev === undefined) {
            delete process.env.INTEGRATION_SYNC_EXECUTION_RETENTION_DAYS;
        } else {
            process.env.INTEGRATION_SYNC_EXECUTION_RETENTION_DAYS = prev;
        }
    });

    it('default 90 dias sem env', () => {
        assert.equal(resolveIntegrationSyncExecutionRetentionDays(), 90);
    });

    it('aceita valor >= 7', () => {
        process.env.INTEGRATION_SYNC_EXECUTION_RETENTION_DAYS = '120';
        assert.equal(resolveIntegrationSyncExecutionRetentionDays(), 120);
    });

    it('valor inválido ou < 7 volta ao default', () => {
        process.env.INTEGRATION_SYNC_EXECUTION_RETENTION_DAYS = '3';
        assert.equal(resolveIntegrationSyncExecutionRetentionDays(), 90);
        process.env.INTEGRATION_SYNC_EXECUTION_RETENTION_DAYS = 'x';
        assert.equal(resolveIntegrationSyncExecutionRetentionDays(), 90);
    });
});
