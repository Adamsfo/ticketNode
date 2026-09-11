/**
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/HospedinOutboundUpdateService.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { HospedinOutboundDesiredAction } from '../../../models/HospedinOutboundSyncState';
import { StatusReservaHospedagem } from '../../../models/ReservaHospedagem';
import { PlaceSuiteMappingStatus } from '../../../models/HospedinPlaceSuiteMap';
import { HospedinOutboundUpdateService } from './HospedinOutboundUpdateService';
import type { HospedinReservationService } from '../services/HospedinReservationService';
import type { HospedinOutboundSaleSyncService } from './HospedinOutboundSaleSyncService';
import type { SaleSyncContext } from './HospedinOutboundSaleSyncService';
import type { HospedinOutboundSuiteReservationService } from './hospedinOutboundSuiteReservationService';
import {
    buildSyncBaselineFromReserva,
    hashOutboundPayload,
    serializeHashInput,
    type OutboundPayloadHashInput,
} from './HospedinOutboundSnapshot';

const stateBase = {
    id: 1,
    id_reserva_hospedagem: 123,
    desired_action: HospedinOutboundDesiredAction.UPDATE,
    hospedin_reservation_id: null,
    hospedin_guest_id: '42',
    payload_hash: 'old-hash',
    pending_payload_hash: 'pending-hash',
    retry_count: 0,
} as any;

function suiteLine(input: {
    id: number;
    idEventoSuite: number;
    valorTotal: number;
    hospedinReservationId?: string | null;
    adultos?: number;
    criancas?: number;
    guestName?: string;
}) {
    return {
        id: input.id,
        idEventoSuite: input.idEventoSuite,
        adultos: input.adultos ?? 2,
        criancas: input.criancas ?? 0,
        valorTotal: input.valorTotal,
        hospedinReservationId: input.hospedinReservationId ?? null,
        ReservaHospede: [{ nome: input.guestName ?? 'Hospede Teste' }],
    };
}

function syncedBaselineFromCurrent(
    adjust?: (input: OutboundPayloadHashInput) => OutboundPayloadHashInput
): string {
    const reserva = buildReservaMock((global as any).__testReservaOverrides);
    let input = buildSyncBaselineFromReserva(reserva as any);
    if (adjust) {
        input = adjust(input);
    }
    return serializeHashInput(input);
}

function setSuiteValor(
    input: OutboundPayloadHashInput,
    idReservaSuite: number,
    valorTotal: number
): OutboundPayloadHashInput {
    const valorTotalCents = Math.round(valorTotal * 100);
    const suites = input.suites.map((suite) =>
        suite.idReservaSuite === idReservaSuite
            ? { ...suite, valorTotalCents }
            : suite
    );
    return {
        ...input,
        suites,
        valorTotalCents,
    };
}

function setSuiteAdultos(
    input: OutboundPayloadHashInput,
    idReservaSuite: number,
    adultos: number
): OutboundPayloadHashInput {
    const suites = input.suites.map((suite) =>
        suite.idReservaSuite === idReservaSuite
            ? { ...suite, adultos }
            : suite
    );
    return {
        ...input,
        suites,
        adultos: suites[0]?.adultos ?? input.adultos,
    };
}

function legacySingleSuiteBaseline(
    adjust?: (input: OutboundPayloadHashInput) => OutboundPayloadHashInput
): string {
    const reserva = buildReservaMock((global as any).__testReservaOverrides);
    let input = buildSyncBaselineFromReserva(reserva as any);
    input = {
        ...input,
        suites: input.suites.map((suite) => ({
            ...suite,
            idReservaSuite: 0,
        })),
    };
    if (adjust) {
        input = adjust(input);
    }
    return serializeHashInput(input);
}

function buildReservaMock(overrides?: Record<string, unknown>) {
    return {
        id: 123,
        idUsuario: 99,
        status: StatusReservaHospedagem.Confirmada,
        checkin: new Date('2026-10-10T14:00:00-03:00'),
        checkout: new Date('2026-10-12T12:00:00-03:00'),
        origemReserva: 'CLIENTE',
        observacoes: null,
        valorTotal: 1300,
        idExterno: (global as any).__testReservaIdExterno ?? null,
        Evento: { tipo: 'Pousada' },
        ReservaSuite: (global as any).__testSuites ?? [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 500,
                hospedinReservationId: '111',
            }),
        ],
        ...overrides,
    };
}

describe('HospedinOutboundUpdateService — multi-suíte UPDATE', () => {
    let patchCalls: Array<{ reservationId: string; patch: Record<string, unknown> }>;
    let saleCalls: SaleSyncContext[];
    let createCalls: number;
    let guestResolveCalls: number;
    let markSyncedCalls: Array<Record<string, unknown>>;
    let releaseToPendingCalls: number;
    let nextReservationId: number;

    let originalFindByPk: typeof import('../../../models/ReservaHospedagem').ReservaHospedagem.findByPk;
    let originalSuiteUpdate: typeof import('../../../models/ReservaSuite').ReservaSuite.update;
    let originalSyncFindByPk: typeof import('../../../models/HospedinOutboundSyncState').HospedinOutboundSyncState.findByPk;
    let originalPlaceFindOne: typeof import('../../../models/HospedinPlace').HospedinPlace.findOne;
    let originalMapFind: typeof import('../services/HospedinPlaceSuiteMapService').hospedinPlaceSuiteMapService.findByEventoSuiteId;
    let originalMarkSynced: typeof import('./HospedinOutboundStateService').hospedinOutboundStateService.markSynced;
    let originalMarkBlocked: typeof import('./HospedinOutboundStateService').hospedinOutboundStateService.markBlocked;
    let originalReleaseToPending: typeof import('./HospedinOutboundStateService').hospedinOutboundStateService.releaseToPending;
    let originalPersistIds: typeof import('./HospedinOutboundStateService').hospedinOutboundStateService.persistHospedinIds;
    let originalUsuarioFindByPk: typeof import('../../../models/Usuario').Usuario.findByPk;

    beforeEach(() => {
        patchCalls = [];
        saleCalls = [];
        createCalls = 0;
        guestResolveCalls = 0;
        markSyncedCalls = [];
        releaseToPendingCalls = 0;
        nextReservationId = 2000;

        const { ReservaHospedagem } = require('../../../models/ReservaHospedagem');
        const { ReservaSuite } = require('../../../models/ReservaSuite');
        const { HospedinOutboundSyncState } = require('../../../models/HospedinOutboundSyncState');
        const { HospedinPlace } = require('../../../models/HospedinPlace');
        const { Usuario } = require('../../../models/Usuario');
        const { hospedinPlaceSuiteMapService } = require('../services/HospedinPlaceSuiteMapService');
        const { hospedinOutboundStateService } = require('./HospedinOutboundStateService');

        originalFindByPk = ReservaHospedagem.findByPk;
        originalSuiteUpdate = ReservaSuite.update;
        originalSyncFindByPk = HospedinOutboundSyncState.findByPk;
        originalPlaceFindOne = HospedinPlace.findOne;
        originalMapFind = hospedinPlaceSuiteMapService.findByEventoSuiteId;
        originalMarkSynced = hospedinOutboundStateService.markSynced;
        originalMarkBlocked = hospedinOutboundStateService.markBlocked;
        originalReleaseToPending = hospedinOutboundStateService.releaseToPending;
        originalPersistIds = hospedinOutboundStateService.persistHospedinIds;
        originalUsuarioFindByPk = Usuario.findByPk;

        ReservaHospedagem.findByPk = async () =>
            buildReservaMock((global as any).__testReservaOverrides);

        ReservaSuite.update = async () => [1] as any;

        HospedinOutboundSyncState.findByPk = async () => {
            const reserva = buildReservaMock(
                (global as any).__testReservaOverrides
            );
            const currentHash = hashOutboundPayload(
                buildSyncBaselineFromReserva(reserva as any)
            );
            return {
                ...stateBase,
                synced_hash_input_json: (global as any).__testBaseline,
                pending_payload_hash:
                    (global as any).__testPendingHash ?? currentHash,
                ...(global as any).__testStateOverrides,
            } as any;
        };

        Usuario.findByPk = async () =>
            ({
                id: 99,
                nomeCompleto: 'Joao',
                sobreNome: 'Silva',
            }) as any;

        HospedinPlace.findOne = async () => ({ place_type_id: 7 }) as any;

        hospedinPlaceSuiteMapService.findByEventoSuiteId = async (
            idEventoSuite: number
        ) =>
            ({
                ativo: true,
                mapping_status: PlaceSuiteMappingStatus.LINKED,
                place_id: idEventoSuite === 101 ? 501 : 502,
            }) as any;

        hospedinOutboundStateService.markSynced = async (
            _id: number,
            input?: Record<string, unknown>
        ) => {
            markSyncedCalls.push(input ?? {});
            return 'synced' as any;
        };

        hospedinOutboundStateService.markBlocked = async () => undefined;

        hospedinOutboundStateService.releaseToPending = async () => {
            releaseToPendingCalls += 1;
            return undefined;
        };

        hospedinOutboundStateService.persistHospedinIds = async () => undefined;
    });

    afterEach(() => {
        const { ReservaHospedagem } = require('../../../models/ReservaHospedagem');
        const { ReservaSuite } = require('../../../models/ReservaSuite');
        const { HospedinOutboundSyncState } = require('../../../models/HospedinOutboundSyncState');
        const { HospedinPlace } = require('../../../models/HospedinPlace');
        const { Usuario } = require('../../../models/Usuario');
        const { hospedinPlaceSuiteMapService } = require('../services/HospedinPlaceSuiteMapService');
        const { hospedinOutboundStateService } = require('./HospedinOutboundStateService');

        ReservaHospedagem.findByPk = originalFindByPk;
        ReservaSuite.update = originalSuiteUpdate;
        HospedinOutboundSyncState.findByPk = originalSyncFindByPk;
        HospedinPlace.findOne = originalPlaceFindOne;
        hospedinPlaceSuiteMapService.findByEventoSuiteId = originalMapFind;
        hospedinOutboundStateService.markSynced = originalMarkSynced;
        hospedinOutboundStateService.markBlocked = originalMarkBlocked;
        hospedinOutboundStateService.releaseToPending = originalReleaseToPending;
        hospedinOutboundStateService.persistHospedinIds = originalPersistIds;
        Usuario.findByPk = originalUsuarioFindByPk;

        delete (global as any).__testSuites;
        delete (global as any).__testReservaOverrides;
        delete (global as any).__testReservaIdExterno;
        delete (global as any).__testStateOverrides;
        delete (global as any).__testBaseline;
        delete (global as any).__staleAfterPatch;
    });

    function buildService() {
        const reservationService: Pick<
            HospedinReservationService,
            'createReservation' | 'updateReservation'
        > = {
            async createReservation() {
                createCalls += 1;
                nextReservationId += 1;
                return {
                    reservationId: String(nextReservationId),
                    searchableCode: `HO:${nextReservationId}`,
                } as any;
            },
            async updateReservation(reservationId, patch) {
                patchCalls.push({ reservationId, patch });
                return { reservationId } as any;
            },
        };

        const saleSyncService: Pick<
            HospedinOutboundSaleSyncService,
            'shouldSyncSale' | 'replaceSale'
        > = {
            shouldSyncSale() {
                return true;
            },
            async replaceSale(ctx: SaleSyncContext) {
                saleCalls.push({ ...ctx });
            },
        };

        const suiteReservationService: Pick<
            HospedinOutboundSuiteReservationService,
            'ensureSuiteReservation'
        > = {
            async ensureSuiteReservation(input) {
                createCalls += 1;
                nextReservationId += 1;
                const reservationId = String(nextReservationId);
                input.linha.hospedinReservationId = reservationId;
                return {
                    ok: true,
                    result: {
                        reservationId,
                        codigoExterno: `HO:${reservationId}`,
                        guestId: String(input.reservaTitularGuestId),
                        wasCreated: true,
                    },
                };
            },
        };

        return new HospedinOutboundUpdateService(
            reservationService as HospedinReservationService,
            saleSyncService as HospedinOutboundSaleSyncService,
            suiteReservationService as HospedinOutboundSuiteReservationService
        );
    }

    it('TESTE 1 — 1 suíte: alterar valor gera 1 SALE com valor da linha', async () => {
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 600,
                hospedinReservationId: '111',
            }),
        ];
        (global as any).__testReservaIdExterno = '111';
        (global as any).__testBaseline = syncedBaselineFromCurrent((input) =>
            setSuiteValor(input, 10, 500)
        );

        const service = buildService();
        const result = await service.update(stateBase);

        assert.equal(result.outcome, 'updated');
        assert.equal(patchCalls.length, 0);
        assert.equal(saleCalls.length, 1);
        assert.equal(saleCalls[0].hospedinReservationId, '111');
        assert.equal(Number(saleCalls[0].valorTotal), 600);
    });

    it('TESTE 2 — alterar somente suíte B: PATCH/SALE apenas em 222', async () => {
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 500,
                hospedinReservationId: '111',
            }),
            suiteLine({
                id: 11,
                idEventoSuite: 102,
                valorTotal: 900,
                hospedinReservationId: '222',
            }),
        ];
        (global as any).__testBaseline = syncedBaselineFromCurrent((input) =>
            setSuiteValor(input, 11, 800)
        );

        const service = buildService();
        const result = await service.update(stateBase);

        assert.equal(result.outcome, 'updated');
        assert.deepEqual(
            patchCalls.map((c) => c.reservationId),
            []
        );
        assert.equal(saleCalls.length, 1);
        assert.equal(saleCalls[0].hospedinReservationId, '222');
        assert.equal(Number(saleCalls[0].valorTotal), 900);
        assert.ok(
            !saleCalls.some((s) => s.hospedinReservationId === '111'),
            'suíte A não deve receber SALE'
        );
    });

    it('TESTE 3 — alterar valor das duas suítes: SALE 600 e 900', async () => {
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 600,
                hospedinReservationId: '111',
            }),
            suiteLine({
                id: 11,
                idEventoSuite: 102,
                valorTotal: 900,
                hospedinReservationId: '222',
            }),
        ];
        (global as any).__testBaseline = syncedBaselineFromCurrent((input) =>
            setSuiteValor(setSuiteValor(input, 10, 500), 11, 800)
        );

        const service = buildService();
        const result = await service.update(stateBase);

        assert.equal(result.outcome, 'updated');
        assert.equal(saleCalls.length, 2);
        assert.deepEqual(
            saleCalls.map((s) => ({
                id: s.hospedinReservationId,
                valor: Number(s.valorTotal),
            })),
            [
                { id: '111', valor: 600 },
                { id: '222', valor: 900 },
            ]
        );
        assert.ok(
            !saleCalls.some((s) => Number(s.valorTotal) === 1500),
            'nunca SALE com soma da reserva'
        );
    });

    it('TESTE 3b — taxa vinculada Suite 1: SALE 430→530, Suite 2 permanece 730', async () => {
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 530,
                hospedinReservationId: '111',
            }),
            suiteLine({
                id: 11,
                idEventoSuite: 102,
                valorTotal: 730,
                hospedinReservationId: '222',
            }),
        ];
        (global as any).__testReservaOverrides = { valorTotal: 1260 };
        (global as any).__testBaseline = syncedBaselineFromCurrent((input) =>
            setSuiteValor(setSuiteValor(input, 10, 430), 11, 730)
        );

        const service = buildService();
        const result = await service.update(stateBase);

        assert.equal(result.outcome, 'updated');
        assert.equal(patchCalls.length, 0);
        assert.equal(saleCalls.length, 1);
        assert.equal(saleCalls[0].hospedinReservationId, '111');
        assert.equal(Number(saleCalls[0].valorTotal), 530);
        assert.ok(
            !saleCalls.some((s) => s.hospedinReservationId === '222'),
            'suíte 2 não deve receber SALE'
        );
        assert.ok(
            !saleCalls.some((s) => Number(s.valorTotal) === 1260),
            'nunca SALE com total da reserva'
        );
        assert.ok(
            !saleCalls.some(
                (s) =>
                    s.hospedinReservationId === '111' &&
                    Number(s.valorTotal) === 430
            ),
            'SALE Suite 1 não pode permanecer 430'
        );
    });

    it('TESTE 3c — editar base Suite 1: SALE 530→550, Suite 2 permanece 950', async () => {
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 550,
                hospedinReservationId: '111',
            }),
            suiteLine({
                id: 11,
                idEventoSuite: 102,
                valorTotal: 950,
                hospedinReservationId: '222',
            }),
        ];
        (global as any).__testReservaOverrides = { valorTotal: 1500 };
        (global as any).__testBaseline = syncedBaselineFromCurrent((input) =>
            setSuiteValor(setSuiteValor(input, 10, 530), 11, 950)
        );

        const service = buildService();
        const result = await service.update(stateBase);

        assert.equal(result.outcome, 'updated');
        assert.equal(patchCalls.length, 0);
        assert.equal(saleCalls.length, 1);
        assert.equal(saleCalls[0].hospedinReservationId, '111');
        assert.equal(Number(saleCalls[0].valorTotal), 550);
        assert.ok(
            !saleCalls.some((s) => s.hospedinReservationId === '222'),
            'suíte 2 não deve receber SALE'
        );
        assert.ok(
            !saleCalls.some((s) => Number(s.valorTotal) === 1500),
            'nunca SALE com total da reserva'
        );
    });

    it('TESTE 4 — alterar checkout: PATCH nas duas reservations', async () => {
        (global as any).__testReservaOverrides = {
            checkout: new Date('2026-10-13T12:00:00-03:00'),
        };
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 500,
                hospedinReservationId: '111',
            }),
            suiteLine({
                id: 11,
                idEventoSuite: 102,
                valorTotal: 800,
                hospedinReservationId: '222',
            }),
        ];
        (global as any).__testBaseline = syncedBaselineFromCurrent((input) => ({
            ...input,
            checkout: '2026-10-12T12:00',
        }));

        const service = buildService();
        const result = await service.update(stateBase);

        assert.equal(result.outcome, 'updated');
        assert.equal(patchCalls.length, 2);
        const expectedCheckout = buildSyncBaselineFromReserva(
            buildReservaMock((global as any).__testReservaOverrides) as any
        ).checkout;
        assert.ok(
            patchCalls.every((c) => c.patch.check_out === expectedCheckout)
        );
        assert.deepEqual(
            patchCalls.map((c) => c.reservationId).sort(),
            ['111', '222']
        );
    });

    it('TESTE 5 — alterar suíte A: PATCH somente em 111', async () => {
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 500,
                hospedinReservationId: '111',
                adultos: 4,
            }),
            suiteLine({
                id: 11,
                idEventoSuite: 102,
                valorTotal: 800,
                hospedinReservationId: '222',
                adultos: 2,
            }),
        ];
        (global as any).__testBaseline = syncedBaselineFromCurrent((input) =>
            setSuiteAdultos(input, 10, 2)
        );

        const service = buildService();
        const result = await service.update(stateBase);

        assert.equal(result.outcome, 'updated');
        assert.equal(patchCalls.length, 1);
        assert.equal(patchCalls[0].reservationId, '111');
        assert.equal(patchCalls[0].patch.adults, 4);
        assert.ok(!('place_id' in patchCalls[0].patch));
    });

    it('TESTE 6 — suíte B sem ID: cria somente B via ensureSuiteReservation', async () => {
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 500,
                hospedinReservationId: '111',
            }),
            suiteLine({
                id: 11,
                idEventoSuite: 102,
                valorTotal: 800,
                hospedinReservationId: null,
            }),
        ];
        (global as any).__testBaseline = syncedBaselineFromCurrent();

        const service = buildService();
        const result = await service.update(stateBase);

        assert.equal(result.outcome, 'updated');
        assert.equal(createCalls, 1);
        assert.equal(saleCalls.length, 1);
        assert.equal(saleCalls[0].hospedinReservationId, '2001');
        assert.equal(Number(saleCalls[0].valorTotal), 800);
        assert.ok(
            !saleCalls.some((s) => s.hospedinReservationId === '111'),
            'A já sincronizada não deve receber novo SALE neste fluxo'
        );
    });

    it('TESTE 7 — suíte B criada no UPDATE reutiliza guest da fila', async () => {
        (global as any).__testStateOverrides = {
            hospedin_guest_id: '2272981',
        };
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 500,
                hospedinReservationId: '111',
            }),
            suiteLine({
                id: 11,
                idEventoSuite: 102,
                valorTotal: 800,
                hospedinReservationId: null,
            }),
        ];
        (global as any).__testBaseline = syncedBaselineFromCurrent();

        const { hospedinOutboundGuestService } = require('./HospedinOutboundGuestService');
        const originalGuestResolve =
            hospedinOutboundGuestService.resolveOrCreateGuestId;
        hospedinOutboundGuestService.resolveOrCreateGuestId = async () => {
            guestResolveCalls += 1;
            throw new Error('não deve criar guest novo');
        };

        try {
            const service = buildService();
            const result = await service.update(stateBase);
            assert.equal(result.outcome, 'updated');
            assert.equal(guestResolveCalls, 0);
            assert.equal(createCalls, 1);
        } finally {
            hospedinOutboundGuestService.resolveOrCreateGuestId =
                originalGuestResolve;
        }
    });

    it('TESTE 8 — idempotência: segunda execução sem duplicar CREATE/SALE', async () => {
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 600,
                hospedinReservationId: '111',
            }),
        ];
        (global as any).__testReservaIdExterno = '111';
        (global as any).__testBaseline = syncedBaselineFromCurrent((input) =>
            setSuiteValor(input, 10, 500)
        );

        const service = buildService();
        const first = await service.update(stateBase);
        assert.equal(first.outcome, 'updated');

        const syncedJson = markSyncedCalls.at(-1)?.syncedHashInputJson;
        assert.ok(syncedJson);

        (global as any).__testBaseline = syncedJson;
        (global as any).__testStateOverrides = {
            payload_hash: hashOutboundPayload(
                JSON.parse(String(syncedJson)) as OutboundPayloadHashInput
            ),
            pending_payload_hash: hashOutboundPayload(
                JSON.parse(String(syncedJson)) as OutboundPayloadHashInput
            ),
        };

        patchCalls = [];
        saleCalls = [];
        createCalls = 0;

        const second = await service.update(stateBase);
        assert.equal(second.outcome, 'idempotent');
        assert.equal(patchCalls.length, 0);
        assert.equal(saleCalls.length, 0);
        assert.equal(createCalls, 0);
    });

    it('TESTE 9 — baseline legado idReservaSuite=0 continua UPDATE', async () => {
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 650,
                hospedinReservationId: null,
            }),
        ];
        (global as any).__testReservaIdExterno = '111';
        (global as any).__testStateOverrides = {
            hospedin_reservation_id: '111',
        };
        (global as any).__testBaseline = legacySingleSuiteBaseline((input) =>
            setSuiteValor(input, 0, 500)
        );

        const service = buildService();
        const result = await service.update(stateBase);

        assert.equal(result.outcome, 'updated');
        assert.equal(saleCalls.length, 1);
        assert.equal(saleCalls[0].hospedinReservationId, '111');
        assert.equal(Number(saleCalls[0].valorTotal), 650);
    });

    it('TESTE 10 — stale durante PROCESSING preserva releaseToPending', async () => {
        (global as any).__testReservaOverrides = {
            checkout: new Date('2026-10-13T12:00:00-03:00'),
        };
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 500,
                hospedinReservationId: '111',
            }),
            suiteLine({
                id: 11,
                idEventoSuite: 102,
                valorTotal: 800,
                hospedinReservationId: '222',
            }),
        ];
        (global as any).__testBaseline = syncedBaselineFromCurrent((input) => ({
            ...input,
            checkout: '2026-10-12T12:00',
        }));
        (global as any).__staleAfterPatch = true;

        const { HospedinOutboundSyncState } = require('../../../models/HospedinOutboundSyncState');
        const originalSyncFind = HospedinOutboundSyncState.findByPk;
        let syncLoadCount = 0;
        HospedinOutboundSyncState.findByPk = async () => {
            syncLoadCount += 1;
            const reserva = buildReservaMock(
                (global as any).__testReservaOverrides
            );
            const currentHash = hashOutboundPayload(
                buildSyncBaselineFromReserva(reserva as any)
            );
            if ((global as any).__staleAfterPatch && syncLoadCount > 1) {
                return {
                    ...stateBase,
                    synced_hash_input_json: (global as any).__testBaseline,
                    pending_payload_hash: 'changed-during-processing',
                } as any;
            }
            return {
                ...stateBase,
                synced_hash_input_json: (global as any).__testBaseline,
                pending_payload_hash: currentHash,
            } as any;
        };

        try {
            const service = buildService();
            const result = await service.update(stateBase);
            assert.equal(result.outcome, 'stale');
            assert.equal(releaseToPendingCalls, 1);
            assert.equal(markSyncedCalls.length, 0);
        } finally {
            HospedinOutboundSyncState.findByPk = originalSyncFind;
        }
    });
});
