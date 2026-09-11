/**
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/HospedinOutboundCreateService.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { HospedinOutboundDesiredAction } from '../../../models/HospedinOutboundSyncState';
import { StatusReservaHospedagem } from '../../../models/ReservaHospedagem';
import { PlaceSuiteMappingStatus } from '../../../models/HospedinPlaceSuiteMap';
import { HospedinOutboundCreateService } from './HospedinOutboundCreateService';
import type { HospedinReservationService } from '../services/HospedinReservationService';
import type { HospedinOutboundGuestService } from './HospedinOutboundGuestService';
import type { HospedinOutboundSaleSyncService } from './HospedinOutboundSaleSyncService';
import type { SaleSyncContext } from './HospedinOutboundSaleSyncService';

const stateBase = {
    id: 1,
    id_reserva_hospedagem: 123,
    desired_action: HospedinOutboundDesiredAction.CREATE,
    hospedin_reservation_id: null,
    hospedin_guest_id: null,
    retry_count: 0,
} as any;

function suiteLine(input: {
    id: number;
    idEventoSuite: number;
    valorTotal: number;
    hospedinReservationId?: string | null;
    guestName?: string;
    guestNames?: string[];
}) {
    const hospedes =
        input.guestNames != null
            ? input.guestNames.map((nome) => ({ nome }))
            : [{ nome: input.guestName ?? 'Hospede Teste' }];

    return {
        id: input.id,
        idEventoSuite: input.idEventoSuite,
        adultos: 2,
        criancas: 0,
        valorTotal: input.valorTotal,
        hospedinReservationId: input.hospedinReservationId ?? null,
        ReservaHospede: hospedes,
    };
}

function buildReservaMock(overrides?: Record<string, unknown>) {
    return {
        id: 123,
        idUsuario: 99,
        status: StatusReservaHospedagem.Confirmada,
        checkin: new Date('2026-10-10'),
        checkout: new Date('2026-10-12'),
        origemReserva: 'CLIENTE',
        observacoes: null,
        valorTotal: 1300,
        Evento: { tipo: 'Pousada' },
        ReservaSuite: (global as any).__testSuites ?? [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 500,
            }),
        ],
        ...overrides,
    };
}

describe('HospedinOutboundCreateService — multi-suíte CREATE', () => {
    let reservaUpdates: Array<Record<string, unknown>>;
    let suiteUpdates: Array<{ id: number; patch: Record<string, unknown> }>;
    let createCalls: Array<{ placeId: number; guestId: number }>;
    let guestResolveCalls: Array<{
        existingGuestId: string | null | undefined;
        guestName: string;
    }>;
    let saleCalls: SaleSyncContext[];
    let nextReservationId: number;
    let originalFindByPk: typeof import('../../../models/ReservaHospedagem').ReservaHospedagem.findByPk;
    let originalReservaUpdate: typeof import('../../../models/ReservaHospedagem').ReservaHospedagem.update;
    let originalSuiteUpdate: typeof import('../../../models/ReservaSuite').ReservaSuite.update;
    let originalSyncFindByPk: typeof import('../../../models/HospedinOutboundSyncState').HospedinOutboundSyncState.findByPk;
    let originalPlaceFindOne: typeof import('../../../models/HospedinPlace').HospedinPlace.findOne;
    let originalMapFind: typeof import('../services/HospedinPlaceSuiteMapService').hospedinPlaceSuiteMapService.findByEventoSuiteId;
    let originalFinalize: typeof import('./HospedinOutboundStateService').hospedinOutboundStateService.finalizeCreateAfterPost;
    let originalPersistIds: typeof import('./HospedinOutboundStateService').hospedinOutboundStateService.persistHospedinIds;
    let originalUsuarioFindByPk: typeof import('../../../models/Usuario').Usuario.findByPk;

    beforeEach(() => {
        reservaUpdates = [];
        suiteUpdates = [];
        createCalls = [];
        guestResolveCalls = [];
        saleCalls = [];
        nextReservationId = 1000;

        const { ReservaHospedagem } = require('../../../models/ReservaHospedagem');
        const { ReservaSuite } = require('../../../models/ReservaSuite');
        const { HospedinOutboundSyncState } = require('../../../models/HospedinOutboundSyncState');
        const { HospedinPlace } = require('../../../models/HospedinPlace');
        const { Usuario } = require('../../../models/Usuario');
        const { hospedinPlaceSuiteMapService } = require('../services/HospedinPlaceSuiteMapService');
        const { hospedinOutboundStateService } = require('./HospedinOutboundStateService');

        originalFindByPk = ReservaHospedagem.findByPk;
        originalReservaUpdate = ReservaHospedagem.update;
        originalSuiteUpdate = ReservaSuite.update;
        originalSyncFindByPk = HospedinOutboundSyncState.findByPk;
        originalPlaceFindOne = HospedinPlace.findOne;
        originalMapFind = hospedinPlaceSuiteMapService.findByEventoSuiteId;
        originalFinalize = hospedinOutboundStateService.finalizeCreateAfterPost;
        originalPersistIds = hospedinOutboundStateService.persistHospedinIds;
        originalUsuarioFindByPk = Usuario.findByPk;

        ReservaHospedagem.findByPk = async (id: number, options?: any) => {
            const attrs = options?.attributes;
            if (attrs) {
                return {
                    id,
                    idExterno: (global as any).__testReservaIdExterno ?? null,
                    codigoExterno: (global as any).__testReservaCodigoExterno ?? null,
                };
            }
            return buildReservaMock((global as any).__testReservaOverrides);
        };

        ReservaHospedagem.update = async (patch: Record<string, unknown>) => {
            reservaUpdates.push(patch);
            return [1] as any;
        };

        ReservaSuite.update = async (
            patch: Record<string, unknown>,
            opts: { where: { id: number } }
        ) => {
            suiteUpdates.push({ id: opts.where.id, patch });
            return [1] as any;
        };

        HospedinOutboundSyncState.findByPk = async () =>
            ({
                ...stateBase,
                ...(global as any).__testStateOverrides,
            }) as any;

        Usuario.findByPk = async () =>
            ((global as any).__testUsuario ??
                ({
                    id: 99,
                    nomeCompleto: 'Joao',
                    sobreNome: 'Silva',
                })) as any;

        HospedinPlace.findOne = async () =>
            ({ place_type_id: 7 }) as any;

        hospedinPlaceSuiteMapService.findByEventoSuiteId = async (
            idEventoSuite: number
        ) =>
            ({
                ativo: true,
                mapping_status: PlaceSuiteMappingStatus.LINKED,
                place_id: idEventoSuite === 101 ? 501 : 502,
            }) as any;

        hospedinOutboundStateService.finalizeCreateAfterPost = async () =>
            'mark_synced' as any;
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
        ReservaHospedagem.update = originalReservaUpdate;
        ReservaSuite.update = originalSuiteUpdate;
        HospedinOutboundSyncState.findByPk = originalSyncFindByPk;
        HospedinPlace.findOne = originalPlaceFindOne;
        hospedinPlaceSuiteMapService.findByEventoSuiteId = originalMapFind;
        hospedinOutboundStateService.finalizeCreateAfterPost = originalFinalize;
        hospedinOutboundStateService.persistHospedinIds = originalPersistIds;
        Usuario.findByPk = originalUsuarioFindByPk;

        delete (global as any).__testSuites;
        delete (global as any).__testReservaOverrides;
        delete (global as any).__testReservaIdExterno;
        delete (global as any).__testReservaCodigoExterno;
        delete (global as any).__testStateOverrides;
        delete (global as any).__testUsuario;
        delete (global as any).__nextHospedinReservationId;
    });

    function buildService() {
        const reservationService: Pick<
            HospedinReservationService,
            'createReservation'
        > = {
            async createReservation(payload: any) {
                createCalls.push({
                    placeId: payload.place_id,
                    guestId: payload.guest_id,
                });
                nextReservationId += 1;
                const reservationId = String(
                    (global as any).__nextHospedinReservationId ??
                        nextReservationId
                );
                if ((global as any).__nextHospedinReservationId != null) {
                    delete (global as any).__nextHospedinReservationId;
                }
                return {
                    reservationId,
                    searchableCode: `HO:${reservationId}`,
                } as any;
            },
        };

        const guestService: Pick<
            HospedinOutboundGuestService,
            'resolveOrCreateGuestId'
        > = {
            async resolveOrCreateGuestId(input) {
                guestResolveCalls.push({
                    existingGuestId: input.existingGuestId,
                    guestName: input.guestName,
                });
                const cached = Number(String(input.existingGuestId || '').trim());
                if (Number.isFinite(cached) && cached > 0) {
                    return cached;
                }
                return 42;
            },
        };

        const saleSyncService: Pick<
            HospedinOutboundSaleSyncService,
            'shouldSyncSale' | 'ensureSaleAfterCreate'
        > = {
            shouldSyncSale() {
                return true;
            },
            async ensureSaleAfterCreate(ctx: SaleSyncContext) {
                saleCalls.push({ ...ctx });
            },
        };

        return new HospedinOutboundCreateService(
            reservationService as HospedinReservationService,
            guestService as HospedinOutboundGuestService,
            saleSyncService as HospedinOutboundSaleSyncService
        );
    }

    it('TESTE 1 — uma suíte: titular único, reservation e SALE com valor da linha', async () => {
        (global as any).__testSuites = [
            suiteLine({ id: 10, idEventoSuite: 101, valorTotal: 500 }),
        ];

        const service = buildService();
        const result = await service.create(stateBase);

        assert.equal(result.outcome, 'created');
        assert.equal(guestResolveCalls.length, 1);
        assert.equal(guestResolveCalls[0].guestName, 'Joao Silva');
        assert.equal(createCalls.length, 1);
        assert.equal(createCalls[0].placeId, 501);
        assert.equal(createCalls[0].guestId, 42);
        assert.equal(saleCalls.length, 1);
        assert.equal(saleCalls[0].valorTotal, 500);
        assert.equal(saleCalls[0].hospedinReservationId, '1001');
        assert.deepEqual(
            suiteUpdates.find((u) => u.id === 10)?.patch,
            { hospedinReservationId: '1001' }
        );
        assert.equal(reservaUpdates.at(-1)?.idExterno, '1001');
    });

    it('TESTE 2 — duas suítes: mesmo guestId, duas reservations e SALES separadas', async () => {
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 500,
                guestName: 'Joao',
            }),
            suiteLine({
                id: 11,
                idEventoSuite: 102,
                valorTotal: 800,
                guestName: 'Maria',
            }),
        ];

        const service = buildService();
        const result = await service.create(stateBase);

        assert.equal(result.outcome, 'created');
        assert.equal(guestResolveCalls.length, 1);
        assert.equal(guestResolveCalls[0].guestName, 'Joao Silva');
        assert.equal(createCalls.length, 2);
        assert.deepEqual(createCalls.map((c) => c.placeId), [501, 502]);
        assert.ok(
            createCalls.every((c) => c.guestId === 42),
            'ambas as reservations devem usar o mesmo guestId'
        );
        assert.equal(saleCalls.length, 2);
        assert.deepEqual(
            saleCalls.map((s) => Number(s.valorTotal)),
            [500, 800]
        );
        assert.ok(
            !saleCalls.some((s) => Number(s.valorTotal) === 1300),
            'não deve existir SALE com valor total da reserva'
        );
        assert.equal(
            suiteUpdates.find((u) => u.id === 10)?.patch.hospedinReservationId,
            '1001'
        );
        assert.equal(
            suiteUpdates.find((u) => u.id === 11)?.patch.hospedinReservationId,
            '1002'
        );
    });

    it('TESTE 3 — segunda suíte sem hóspede com nome usa titular da ReservaHospedagem', async () => {
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 430,
                guestName: 'Joao',
            }),
            suiteLine({
                id: 11,
                idEventoSuite: 102,
                valorTotal: 730,
                guestNames: ['', '   '],
            }),
        ];

        const service = buildService();
        const result = await service.create(stateBase);

        assert.equal(result.outcome, 'created');
        assert.equal(guestResolveCalls.length, 1);
        assert.equal(guestResolveCalls[0].guestName, 'Joao Silva');
        assert.equal(createCalls.length, 2);
        assert.ok(createCalls.every((c) => c.guestId === 42));
        assert.deepEqual(
            saleCalls.map((s) => Number(s.valorTotal)),
            [430, 730]
        );
    });

    it('TESTE 4 — guest já existente na fila: reutiliza sem recriar guest', async () => {
        (global as any).__testStateOverrides = {
            hospedin_guest_id: '2272981',
        };
        (global as any).__testSuites = [
            suiteLine({ id: 10, idEventoSuite: 101, valorTotal: 430 }),
            suiteLine({ id: 11, idEventoSuite: 102, valorTotal: 730 }),
        ];

        const service = buildService();
        const result = await service.create(stateBase);

        assert.equal(result.outcome, 'created');
        assert.equal(guestResolveCalls.length, 1);
        assert.equal(guestResolveCalls[0].existingGuestId, '2272981');
        assert.equal(guestResolveCalls[0].guestName, 'Joao Silva');
        assert.equal(createCalls.length, 2);
        assert.ok(
            createCalls.every((c) => c.guestId === 2272981),
            'deve reutilizar o guestId da fila nas duas suítes'
        );
    });

    it('idempotência: suíte com hospedinReservationId não duplica POST', async () => {
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 500,
                hospedinReservationId: '1001',
            }),
        ];

        const service = buildService();
        const result = await service.create(stateBase);

        assert.equal(result.outcome, 'idempotent');
        assert.equal(createCalls.length, 0);
        assert.equal(saleCalls.length, 1);
        assert.equal(saleCalls[0].hospedinReservationId, '1001');
        assert.equal(saleCalls[0].valorTotal, 500);
        assert.equal(suiteUpdates.length, 0);
    });

    it('suíte A com ID e suíte B sem ID cria somente B', async () => {
        (global as any).__testSuites = [
            suiteLine({
                id: 10,
                idEventoSuite: 101,
                valorTotal: 500,
                hospedinReservationId: '1001',
            }),
            suiteLine({ id: 11, idEventoSuite: 102, valorTotal: 800 }),
        ];
        (global as any).__testReservaOverrides = {
            idExterno: '1001',
        };
        (global as any).__testReservaIdExterno = '1001';
        (global as any).__testReservaCodigoExterno = 'HO:1001';
        (global as any).__nextHospedinReservationId = 1002;

        const service = buildService();
        const result = await service.create(stateBase);

        assert.equal(result.outcome, 'created');
        assert.equal(createCalls.length, 1);
        assert.equal(createCalls[0].placeId, 502);
        assert.equal(saleCalls.length, 2);
        assert.equal(
            saleCalls.find((s) => s.hospedinReservationId === '1001')?.valorTotal,
            500
        );
        assert.equal(saleCalls.at(-1)?.hospedinReservationId, '1002');
        assert.equal(saleCalls.at(-1)?.valorTotal, 800);
        assert.equal(
            suiteUpdates.find((u) => u.id === 11)?.patch.hospedinReservationId,
            '1002'
        );
    });
});
