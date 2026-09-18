/**
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/hospedinOutboundExecutionDismissalService.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    readHospedinOutboundAdminDismissal,
} from './hospedinOutboundExecutionDismissalService';

describe('readHospedinOutboundAdminDismissal', () => {
    it('retorna null quando não há dismissal', () => {
        assert.equal(readHospedinOutboundAdminDismissal(null), null);
        assert.equal(readHospedinOutboundAdminDismissal({ items: [] }), null);
    });

    it('retorna adminDismissal quando dismissed=true', () => {
        const dismissal = {
            dismissed: true,
            dismissedAt: '2026-09-18T20:00:00.000Z',
            dismissedByUserId: 10,
            dismissedByUserName: 'Operador',
        };
        const result = readHospedinOutboundAdminDismissal({
            items: [{ id: 1 }],
            adminDismissal: dismissal,
        });
        assert.deepEqual(result, dismissal);
    });
});
