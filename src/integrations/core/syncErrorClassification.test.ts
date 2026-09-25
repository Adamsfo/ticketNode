/**
 * Classificação de erros — pool Sequelize vs timeout transitório de integração.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    SyncErrorCode,
    isSequelizeConnectionPoolAcquireFailure,
    isTransientErrorCode,
    normalizeSyncErrorCode,
} from './syncErrorClassification';

describe('isSequelizeConnectionPoolAcquireFailure', () => {
    it('A) SequelizeConnectionAcquireTimeoutError → pool acquire (sem retry transitório)', () => {
        assert.equal(
            isSequelizeConnectionPoolAcquireFailure(
                'SequelizeConnectionAcquireTimeoutError',
                'Operation timeout'
            ),
            true
        );
        const code = normalizeSyncErrorCode(
            'SequelizeConnectionAcquireTimeoutError',
            'Operation timeout'
        );
        assert.equal(code, SyncErrorCode.UNKNOWN_ERROR);
        assert.equal(isTransientErrorCode(code), false);
    });

    it('A) mensagem Operation timeout isolada → pool acquire', () => {
        assert.equal(
            isSequelizeConnectionPoolAcquireFailure(null, 'Operation timeout'),
            true
        );
        const code = normalizeSyncErrorCode(null, 'Operation timeout');
        assert.equal(code, SyncErrorCode.UNKNOWN_ERROR);
        assert.equal(isTransientErrorCode(code), false);
    });
});

describe('normalizeSyncErrorCode — timeouts transitórios preservados', () => {
    it('B) timeout HTTP/rede genérico → TIMEOUT transitório', () => {
        const code = normalizeSyncErrorCode(
            null,
            'Request timeout after 30000ms'
        );
        assert.equal(code, SyncErrorCode.TIMEOUT);
        assert.equal(isTransientErrorCode(code), true);
    });

    it('C) ETIMEDOUT → TIMEOUT transitório', () => {
        const code = normalizeSyncErrorCode(null, 'connect ETIMEDOUT 10.0.0.1:443');
        assert.equal(code, SyncErrorCode.TIMEOUT);
        assert.equal(isTransientErrorCode(code), true);
    });

    it('rede → NETWORK_ERROR transitório', () => {
        const code = normalizeSyncErrorCode(null, 'network error on fetch');
        assert.equal(code, SyncErrorCode.NETWORK_ERROR);
        assert.equal(isTransientErrorCode(code), true);
    });
});
