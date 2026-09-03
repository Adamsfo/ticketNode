/**
 * Testes offline — hash outbound (ETAPA 5.1).
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/HospedinOutboundSnapshot.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    buildOutboundUpdatePatch,
    buildOutboundNote,
} from './HospedinOutboundPayloadBuilder';
import {
    buildSnapshotFromReserva,
    hashOutboundPayload,
    normalizeHashInput,
    parseSyncedHashInputJson,
    snapshotToHashInput,
    type OutboundPayloadHashInput,
} from './HospedinOutboundSnapshot';

const baseInput = (): OutboundPayloadHashInput => ({
    checkin: '2026-10-18T10:00',
    checkout: '2026-10-20T08:00',
    idEventoSuite: 3,
    observacoes: 'Obs base',
    adultos: 2,
    criancas: 0,
});

describe('hash outbound — campos suportados', () => {
    it('não inclui status nem hospedes no JSON do hash', () => {
        const hash = hashOutboundPayload(baseInput());
        const keys = Object.keys(JSON.parse(JSON.stringify(baseInput())));
        assert.deepEqual(keys, [
            'checkin',
            'checkout',
            'idEventoSuite',
            'observacoes',
            'adultos',
            'criancas',
        ]);
        assert.ok(hash.length === 64);
    });

    it('mudança somente de status Jango não altera o hash', () => {
        const snapConfirmada = buildSnapshotFromReserva({
            checkin: new Date('2026-10-18T14:00:00.000Z'),
            checkout: new Date('2026-10-20T12:00:00.000Z'),
            observacoes: 'Mesma obs',
            status: 'Confirmada',
            ReservaSuite: [
                {
                    idEventoSuite: 3,
                    adultos: 2,
                    criancas: 0,
                } as any,
            ],
        } as any);

        const snapHospedada = buildSnapshotFromReserva({
            checkin: new Date('2026-10-18T14:00:00.000Z'),
            checkout: new Date('2026-10-20T12:00:00.000Z'),
            observacoes: 'Mesma obs',
            status: 'Hospedada',
            ReservaSuite: [
                {
                    idEventoSuite: 3,
                    adultos: 2,
                    criancas: 0,
                } as any,
            ],
        } as any);

        const h1 = hashOutboundPayload(snapshotToHashInput(snapConfirmada));
        const h2 = hashOutboundPayload(snapshotToHashInput(snapHospedada));
        assert.equal(h1, h2);
    });

    it('mudança somente de hóspedes não altera o hash', () => {
        const before = buildSnapshotFromReserva({
            checkin: new Date('2026-10-18T14:00:00.000Z'),
            checkout: new Date('2026-10-20T12:00:00.000Z'),
            observacoes: 'Obs',
            ReservaSuite: [
                {
                    idEventoSuite: 3,
                    adultos: 2,
                    criancas: 0,
                    ReservaHospede: [{ nome: 'Maria', tipo: 'Adulto' }],
                } as any,
            ],
        } as any);

        const after = buildSnapshotFromReserva({
            checkin: new Date('2026-10-18T14:00:00.000Z'),
            checkout: new Date('2026-10-20T12:00:00.000Z'),
            observacoes: 'Obs',
            ReservaSuite: [
                {
                    idEventoSuite: 3,
                    adultos: 2,
                    criancas: 0,
                    ReservaHospede: [{ nome: 'João', tipo: 'Adulto' }],
                } as any,
            ],
        } as any);

        assert.equal(
            hashOutboundPayload(snapshotToHashInput(before)),
            hashOutboundPayload(snapshotToHashInput(after))
        );
    });

    it('normaliza baseline legado removendo status e hospedes', () => {
        const legacy = JSON.stringify({
            ...baseInput(),
            status: 'Hospedada',
            hospedes: [{ nome: 'X', tipo: 'Adulto', dataNascimento: null }],
        });
        const parsed = parseSyncedHashInputJson(legacy);
        assert.deepEqual(parsed, baseInput());
        assert.deepEqual(
            normalizeHashInput(JSON.parse(legacy)),
            baseInput()
        );
    });
});

describe('diff / PATCH — campos suportados', () => {
    it('observação gera note-only', () => {
        const before = baseInput();
        const after = { ...before, observacoes: 'Nova obs' };
        const { patch } = buildOutboundUpdatePatch({
            idReservaHospedagem: 127,
            before,
            after,
        });
        assert.deepEqual(patch, {
            note: buildOutboundNote(127, 'Nova obs'),
        });
    });

    it('datas geram check_in e check_out', () => {
        const before = baseInput();
        const after = {
            ...before,
            checkin: '2026-10-19T10:00',
            checkout: '2026-10-21T08:00',
        };
        const { patch } = buildOutboundUpdatePatch({
            idReservaHospedagem: 50,
            before,
            after,
        });
        assert.equal(patch.check_in, '2026-10-19T10:00');
        assert.equal(patch.check_out, '2026-10-21T08:00');
    });

    it('troca de suíte gera place_id e place_type_id', () => {
        const before = baseInput();
        const after = { ...before, idEventoSuite: 99 };
        const { patch } = buildOutboundUpdatePatch({
            idReservaHospedagem: 50,
            before,
            after,
            placeId: 445906,
            placeTypeId: 131939,
        });
        assert.equal(patch.place_id, 445906);
        assert.equal(patch.place_type_id, 131939);
    });

    it('adultos/crianças geram adults/children', () => {
        const before = baseInput();
        const after = { ...before, adultos: 3, criancas: 1 };
        const { patch } = buildOutboundUpdatePatch({
            idReservaHospedagem: 50,
            before,
            after,
        });
        assert.equal(patch.adults, 3);
        assert.equal(patch.children, 1);
    });

    it('hash igual → patch vazio (idempotência)', () => {
        const input = baseInput();
        const { patch, changedFields } = buildOutboundUpdatePatch({
            idReservaHospedagem: 1,
            before: input,
            after: input,
        });
        assert.deepEqual(patch, {});
        assert.deepEqual(changedFields, []);
    });

    it('PATCH não contém campos financeiros', () => {
        const { patch } = buildOutboundUpdatePatch({
            idReservaHospedagem: 127,
            before: baseInput(),
            after: { ...baseInput(), observacoes: 'X' },
        });
        assert.ok(!('daily_cents' in patch));
        assert.ok(!('total_daily_cents' in patch));
        assert.ok(!('sale_channel_id' in patch));
        assert.ok(!('guest_id' in patch));
    });
});

describe('check-in / check-out — sem diff outbound', () => {
    it('somente status não produz changedFields', () => {
        const input = baseInput();
        const { changedFields, patch } = buildOutboundUpdatePatch({
            idReservaHospedagem: 1,
            before: input,
            after: input,
        });
        assert.deepEqual(changedFields, []);
        assert.deepEqual(patch, {});
    });
});
