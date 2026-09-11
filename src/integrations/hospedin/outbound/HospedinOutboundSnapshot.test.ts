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
    buildSyncBaselineFromReserva,
    hashOutboundPayload,
    normalizeHashInput,
    parseSyncedHashInputJson,
    snapshotToHashInput,
    type OutboundPayloadHashInput,
} from './HospedinOutboundSnapshot';

const baseInput = (): OutboundPayloadHashInput => ({
    checkin: '2026-10-18T10:00',
    checkout: '2026-10-20T08:00',
    observacoes: 'Obs base',
    suites: [
        {
            idReservaSuite: 10,
            idEventoSuite: 3,
            adultos: 2,
            criancas: 0,
            valorTotalCents: 0,
        },
    ],
    idEventoSuite: 3,
    adultos: 2,
    criancas: 0,
    valorTotalCents: 0,
});

function reservaDuasSuites(overrides?: {
    suite1?: Record<string, unknown>;
    suite2?: Record<string, unknown>;
    shared?: Record<string, unknown>;
}) {
    return {
        checkin: new Date('2026-10-18T14:00:00.000Z'),
        checkout: new Date('2026-10-20T12:00:00.000Z'),
        observacoes: 'Obs',
        valorTotal: 1300,
        ...overrides?.shared,
        ReservaSuite: [
            {
                id: 10,
                idEventoSuite: 101,
                adultos: 2,
                criancas: 0,
                valorTotal: 500,
                ...overrides?.suite1,
            } as any,
            {
                id: 11,
                idEventoSuite: 102,
                adultos: 2,
                criancas: 0,
                valorTotal: 800,
                ...overrides?.suite2,
            } as any,
        ],
    };
}

describe('hash outbound — campos suportados', () => {
    it('não inclui status nem hospedes no JSON do hash', () => {
        const hash = hashOutboundPayload(baseInput());
        const keys = Object.keys(JSON.parse(JSON.stringify(baseInput())));
        assert.deepEqual(keys, [
            'checkin',
            'checkout',
            'observacoes',
            'suites',
            'idEventoSuite',
            'adultos',
            'criancas',
            'valorTotalCents',
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

    it('TESTE 6 — normaliza baseline legado removendo status e hospedes', () => {
        const legacyFlat = {
            checkin: '2026-10-18T10:00',
            checkout: '2026-10-20T08:00',
            idEventoSuite: 3,
            observacoes: 'Obs base',
            adultos: 2,
            criancas: 0,
            valorTotalCents: 88000,
            status: 'Hospedada',
            hospedes: [{ nome: 'X', tipo: 'Adulto', dataNascimento: null }],
        };
        const legacy = JSON.stringify(legacyFlat);
        const parsed = parseSyncedHashInputJson(legacy);
        assert.ok(parsed);
        assert.deepEqual(parsed!.suites, [
            {
                idReservaSuite: 0,
                idEventoSuite: 3,
                adultos: 2,
                criancas: 0,
                valorTotalCents: 88000,
            },
        ]);
        assert.equal(parsed!.idEventoSuite, 3);
        assert.equal(parsed!.valorTotalCents, 88000);
        assert.deepEqual(
            normalizeHashInput(JSON.parse(legacy)),
            parsed
        );
    });
});

describe('hash multi-suíte — baseline suites[]', () => {
    it('TESTE 1 — uma suíte: baseline com suites[] e campos legados', () => {
        const baseline = buildSyncBaselineFromReserva({
            valorTotal: 500,
            checkin: new Date('2026-10-18T14:00:00.000Z'),
            checkout: new Date('2026-10-20T12:00:00.000Z'),
            observacoes: 'Obs',
            ReservaSuite: [
                {
                    id: 10,
                    idEventoSuite: 3,
                    adultos: 2,
                    criancas: 0,
                    valorTotal: 500,
                } as any,
            ],
        } as any);

        assert.equal(baseline.suites.length, 1);
        assert.equal(baseline.suites[0].idReservaSuite, 10);
        assert.equal(baseline.suites[0].valorTotalCents, 50000);
        assert.equal(baseline.idEventoSuite, 3);
        assert.equal(baseline.valorTotalCents, 50000);
    });

    it('TESTE 2 — alteração somente na suíte 1 altera o hash', () => {
        const before = buildSyncBaselineFromReserva(reservaDuasSuites() as any);
        const after = buildSyncBaselineFromReserva(
            reservaDuasSuites({
                suite1: { adultos: 3 },
            }) as any
        );

        assert.notEqual(
            hashOutboundPayload(before),
            hashOutboundPayload(after)
        );
        assert.equal(before.suites[0].adultos, 2);
        assert.equal(after.suites[0].adultos, 3);
        assert.deepEqual(before.suites[1], after.suites[1]);
    });

    it('TESTE 2b — alteração somente na suíte 2 altera o hash', () => {
        const before = buildSyncBaselineFromReserva(reservaDuasSuites() as any);
        const after = buildSyncBaselineFromReserva(
            reservaDuasSuites({
                suite2: { idEventoSuite: 999 },
            }) as any
        );

        assert.notEqual(
            hashOutboundPayload(before),
            hashOutboundPayload(after)
        );
        assert.equal(before.suites[1].idEventoSuite, 102);
        assert.equal(after.suites[1].idEventoSuite, 999);
        assert.deepEqual(before.suites[0], after.suites[0]);
    });

    it('TESTE 3 — alteração de valor da suíte 1 altera o hash', () => {
        const before = buildSyncBaselineFromReserva(reservaDuasSuites() as any);
        const after = buildSyncBaselineFromReserva(
            reservaDuasSuites({
                suite1: { valorTotal: 600 },
                shared: { valorTotal: 1400 },
            }) as any
        );

        assert.notEqual(
            hashOutboundPayload(before),
            hashOutboundPayload(after)
        );
        assert.equal(before.suites[0].valorTotalCents, 50000);
        assert.equal(after.suites[0].valorTotalCents, 60000);
    });

    it('adicionar segunda suíte altera o hash', () => {
        const before = buildSyncBaselineFromReserva({
            valorTotal: 500,
            checkin: new Date('2026-10-18T14:00:00.000Z'),
            checkout: new Date('2026-10-20T12:00:00.000Z'),
            observacoes: 'Obs',
            ReservaSuite: [
                {
                    id: 10,
                    idEventoSuite: 101,
                    adultos: 2,
                    criancas: 0,
                    valorTotal: 500,
                } as any,
            ],
        } as any);
        const after = buildSyncBaselineFromReserva(reservaDuasSuites() as any);

        assert.equal(before.suites.length, 1);
        assert.equal(after.suites.length, 2);
        assert.notEqual(
            hashOutboundPayload(before),
            hashOutboundPayload(after)
        );
    });

    it('datas compartilhadas alteram o hash de todas as suítes na baseline', () => {
        const before = buildSyncBaselineFromReserva(reservaDuasSuites() as any);
        const after = buildSyncBaselineFromReserva(
            reservaDuasSuites({
                shared: {
                    checkin: new Date('2026-10-19T14:00:00.000Z'),
                },
            }) as any
        );

        assert.notEqual(before.checkin, after.checkin);
        assert.notEqual(
            hashOutboundPayload(before),
            hashOutboundPayload(after)
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

describe('hash financeiro', () => {
    it('alteração somente de valorTotal gera dirty', () => {
        const before = buildSyncBaselineFromReserva({
            valorTotal: 500,
            checkin: new Date('2026-10-18T14:00:00.000Z'),
            checkout: new Date('2026-10-20T12:00:00.000Z'),
            observacoes: 'Obs',
            ReservaSuite: [
                {
                    id: 10,
                    idEventoSuite: 3,
                    adultos: 2,
                    criancas: 0,
                    valorTotal: 500,
                } as any,
            ],
        } as any);
        const after = buildSyncBaselineFromReserva({
            valorTotal: 880,
            checkin: new Date('2026-10-18T14:00:00.000Z'),
            checkout: new Date('2026-10-20T12:00:00.000Z'),
            observacoes: 'Obs',
            ReservaSuite: [
                {
                    id: 10,
                    idEventoSuite: 3,
                    adultos: 2,
                    criancas: 0,
                    valorTotal: 880,
                } as any,
            ],
        } as any);

        assert.notEqual(
            hashOutboundPayload(before),
            hashOutboundPayload(after)
        );
        assert.equal(before.valorTotalCents, 50000);
        assert.equal(after.valorTotalCents, 88000);
        assert.equal(before.suites[0].valorTotalCents, 50000);
        assert.equal(after.suites[0].valorTotalCents, 88000);
    });

    it('valorTotal zerado permanece 0 no hash (sem fallback preco/taxaServico)', () => {
        const baseline = buildSyncBaselineFromReserva({
            valorTotal: 0,
            preco: 430,
            taxaServico: 0,
            checkin: new Date('2026-09-10T14:00:00.000Z'),
            checkout: new Date('2026-09-11T12:00:00.000Z'),
            ReservaSuite: [{ idEventoSuite: 1, adultos: 2, criancas: 0 } as any],
        } as any);
        assert.equal(baseline.valorTotalCents, 0);
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
