import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GATEWAYS_TEF } from './caixaService';

describe('caixaService', () => {
    it('inclui TEF Stone e POS Stone no grupo TEF', () => {
        assert.deepEqual([...GATEWAYS_TEF], ['TEF Stone', 'POS Stone']);
    });
});
