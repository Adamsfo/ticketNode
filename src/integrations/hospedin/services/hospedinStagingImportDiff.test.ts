import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    canonicalizePayloadForStagingHash,
    classifyStagingImportChange,
    hasInboundImportWork,
    hashStagingPayload,
} from './hospedinStagingImportDiff';

describe('classifyStagingImportChange', () => {
    it('sem staging existente → created', () => {
        assert.equal(
            classifyStagingImportChange(null, {
                status: 'confirmed',
                checkin: new Date('2026-10-01T12:00:00Z'),
                checkout: new Date('2026-10-03T12:00:00Z'),
                payload_json: { id: 99, status: 'confirmed' },
            }),
            'created'
        );
    });

    it('mesmo payload hash e colunas → unchanged', () => {
        const payload = { id: 1, status: 'confirmed', note: 'x' };
        const existing = {
            status: 'confirmed',
            checkin: new Date('2026-10-01T12:00:00.000Z'),
            checkout: new Date('2026-10-03T12:00:00.000Z'),
            payload_json: payload,
        };
        assert.equal(
            classifyStagingImportChange(existing, {
                status: 'confirmed',
                checkin: new Date('2026-10-01T12:00:00.000Z'),
                checkout: new Date('2026-10-03T12:00:00.000Z'),
                payload_json: { ...payload },
            }),
            'unchanged'
        );
    });

    it('payload alterado → updated', () => {
        const existing = {
            status: 'confirmed',
            checkin: new Date('2026-10-01T12:00:00Z'),
            checkout: new Date('2026-10-03T12:00:00Z'),
            payload_json: { id: 1, status: 'confirmed', note: 'a' },
        };
        assert.equal(
            classifyStagingImportChange(existing, {
                status: 'confirmed',
                checkin: new Date('2026-10-01T12:00:00Z'),
                checkout: new Date('2026-10-03T12:00:00Z'),
                payload_json: { id: 1, status: 'confirmed', note: 'b' },
            }),
            'updated'
        );
    });

    it('status divergente com mesmo payload → updated', () => {
        const payload = { id: 1, status: 'cancelled' };
        const hash = hashStagingPayload(payload);
        assert.ok(hash.length > 0);
        const existing = {
            status: 'confirmed',
            checkin: null,
            checkout: null,
            payload_json: payload,
        };
        assert.equal(
            classifyStagingImportChange(existing, {
                status: 'cancelled',
                checkin: null,
                checkout: null,
                payload_json: payload,
            }),
            'updated'
        );
    });
});

describe('hasInboundImportWork', () => {
    it('created ou updated → true', () => {
        assert.equal(hasInboundImportWork({ created: 1, updated: 0 }), true);
        assert.equal(hasInboundImportWork({ created: 0, updated: 1 }), true);
        assert.equal(hasInboundImportWork({ created: 0, updated: 0 }), false);
    });
});

describe('hash estável (import)', () => {
    const base = {
        id: 42,
        status: 'confirmed',
        total: 1500,
        note: 'hospede',
    };

    it('1 — mesmo payload comercial → unchanged', () => {
        const existing = {
            status: 'confirmed',
            checkin: new Date('2026-10-01T12:00:00Z'),
            checkout: new Date('2026-10-03T12:00:00Z'),
            payload_json: { ...base, z: 1 },
        };
        assert.equal(
            classifyStagingImportChange(existing, {
                status: 'confirmed',
                checkin: new Date('2026-10-01T12:00:00Z'),
                checkout: new Date('2026-10-03T12:00:00Z'),
                payload_json: { z: 1, ...base },
            }),
            'unchanged'
        );
    });

    it('2 — só _jango_guest_enriched_at diferente → unchanged', () => {
        const existing = {
            status: 'confirmed',
            checkin: null,
            checkout: null,
            payload_json: {
                ...base,
                _jango_guest_enriched_at: '2026-01-01T00:00:00.000Z',
            },
        };
        assert.equal(
            classifyStagingImportChange(existing, {
                status: 'confirmed',
                checkin: null,
                checkout: null,
                payload_json: {
                    ...base,
                    _jango_guest_enriched_at: '2026-09-26T03:00:00.000Z',
                },
            }),
            'unchanged'
        );
    });

    it('3 — alteração comercial (total) → updated', () => {
        const existing = {
            status: 'confirmed',
            checkin: null,
            checkout: null,
            payload_json: { ...base, total: 1500 },
        };
        assert.equal(
            classifyStagingImportChange(existing, {
                status: 'confirmed',
                checkin: null,
                checkout: null,
                payload_json: { ...base, total: 1600 },
            }),
            'updated'
        );
    });

    it('4 — propriedades em ordem diferente → unchanged', () => {
        const a = canonicalizePayloadForStagingHash({ b: 2, a: 1 });
        const b = canonicalizePayloadForStagingHash({ a: 1, b: 2 });
        assert.deepEqual(a, b);
        assert.equal(hashStagingPayload({ b: 2, a: 1 }), hashStagingPayload({ a: 1, b: 2 }));
    });
});
