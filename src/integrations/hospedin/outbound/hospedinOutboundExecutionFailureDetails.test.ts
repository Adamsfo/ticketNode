/**
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/hospedinOutboundExecutionFailureDetails.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    isOutboundFailureOutcome,
    parseHttpStatusFromErrorCode,
    resolveOutboundHttpStatus,
} from './hospedinOutboundExecutionFailureDetails';

describe('isOutboundFailureOutcome', () => {
    it('identifica failed, retry e error', () => {
        assert.equal(isOutboundFailureOutcome('failed'), true);
        assert.equal(isOutboundFailureOutcome('retry'), true);
        assert.equal(isOutboundFailureOutcome('error'), true);
        assert.equal(isOutboundFailureOutcome('updated'), false);
        assert.equal(isOutboundFailureOutcome('claim_skipped'), false);
    });
});

describe('parseHttpStatusFromErrorCode', () => {
    it('extrai status HTTP do errorCode', () => {
        assert.equal(parseHttpStatusFromErrorCode('HTTP_409'), 409);
        assert.equal(parseHttpStatusFromErrorCode('HTTP_422'), 422);
        assert.equal(parseHttpStatusFromErrorCode('VALIDATION_ERROR'), null);
        assert.equal(parseHttpStatusFromErrorCode(null), null);
    });
});

describe('resolveOutboundHttpStatus', () => {
    it('prioriza httpStatus explícito', () => {
        assert.equal(
            resolveOutboundHttpStatus({ httpStatus: 503, errorCode: 'HTTP_409' }),
            503
        );
    });

    it('usa errorCode quando httpStatus ausente', () => {
        assert.equal(
            resolveOutboundHttpStatus({ errorCode: 'HTTP_404' }),
            404
        );
    });
});
