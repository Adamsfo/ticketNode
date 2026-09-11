/**
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/HospedinOutboundCancelService.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { HospedinOutboundDesiredAction } from '../../../models/HospedinOutboundSyncState';
import { StatusReservaHospedagem } from '../../../models/ReservaHospedagem';
import { HospedinApiError } from '../types/errors';
import { HospedinOutboundCancelService } from './HospedinOutboundCancelService';
import type { HospedinReservationService } from '../services/HospedinReservationService';
import { collectDistinctHospedinReservationIds } from './hospedinOutboundSuiteReservationService';

const stateBase = {
    id: 1,
    id_reserva_hospedagem: 200,
    desired_action: HospedinOutboundDesiredAction.CANCEL,
    hospedin_reservation_id: null,
    hospedin_guest_id: '42',
    retry_count: 0,
} as any;

function suiteLine(input: {
    id: number;
    hospedinReservationId?: string | null;
}) {
    return {
        id: input.id,
        idEventoSuite: input.id,
        hospedinReservationId: input.hospedinReservationId ?? null,
    };
}

describe('collectDistinctHospedinReservationIds', () => {
    it('deduplica idExterno repetido com IDs das suítes', () => {
        const ids = collectDistinctHospedinReservationIds({
            suites: [
                suiteLine({ id: 10, hospedinReservationId: '111' }),
                suiteLine({ id: 11, hospedinReservationId: '222' }),
            ],
            reservaIdExterno: '111',
            queueReservationId: null,
        });
        assert.deepEqual(ids, ['111', '222']);
    });
});

describe('HospedinOutboundCancelService — multi-suíte CANCEL', () => {
    let getCalls: string[];
    let patchCalls: string[];
    let markSyncedCalls: Array<Record<string, unknown>>;
    let markWaitRetryCalls: number;
    let markFailedCalls: Array<Record<string, unknown>>;

    let originalFindByPk: typeof import('../../../models/ReservaHospedagem').ReservaHospedagem.findByPk;
    let originalSyncFindByPk: typeof import('../../../models/HospedinOutboundSyncState').HospedinOutboundSyncState.findByPk;
    let originalMarkSynced: typeof import('./HospedinOutboundStateService').hospedinOutboundStateService.markSynced;
    let originalMarkWaitRetry: typeof import('./HospedinOutboundStateService').hospedinOutboundStateService.markWaitRetry;
    let originalMarkFailed: typeof import('./HospedinOutboundStateService').hospedinOutboundStateService.markFailed;
    let originalMarkAborted: typeof import('./HospedinOutboundStateService').hospedinOutboundStateService.markAborted;

    beforeEach(() => {
        getCalls = [];
        patchCalls = [];
        markSyncedCalls = [];
        markWaitRetryCalls = 0;
        markFailedCalls = [];
        delete (global as any).__getErrorById;
        delete (global as any).__patchErrorById;
        delete (global as any).__remoteStatusById;

        const { ReservaHospedagem } = require('../../../models/ReservaHospedagem');
        const { HospedinOutboundSyncState } = require('../../../models/HospedinOutboundSyncState');
        const { hospedinOutboundStateService } = require('./HospedinOutboundStateService');

        originalFindByPk = ReservaHospedagem.findByPk;
        originalSyncFindByPk = HospedinOutboundSyncState.findByPk;
        originalMarkSynced = hospedinOutboundStateService.markSynced;
        originalMarkWaitRetry = hospedinOutboundStateService.markWaitRetry;
        originalMarkFailed = hospedinOutboundStateService.markFailed;
        originalMarkAborted = hospedinOutboundStateService.markAborted;

        ReservaHospedagem.findByPk = async () => ({
            id: 200,
            status: StatusReservaHospedagem.Cancelada,
            idExterno: (global as any).__testReservaIdExterno ?? null,
            ReservaSuite: (global as any).__testSuites ?? [
                suiteLine({ id: 10, hospedinReservationId: '111' }),
            ],
        });

        HospedinOutboundSyncState.findByPk = async () =>
            ({
                ...stateBase,
                ...(global as any).__testStateOverrides,
            }) as any;

        hospedinOutboundStateService.markSynced = async (
            _id: number,
            input?: Record<string, unknown>
        ) => {
            markSyncedCalls.push(input ?? {});
            return 'synced' as any;
        };
        hospedinOutboundStateService.markWaitRetry = async () => {
            markWaitRetryCalls += 1;
        };
        hospedinOutboundStateService.markFailed = async (
            _id: number,
            input: Record<string, unknown>
        ) => {
            markFailedCalls.push(input);
        };
        hospedinOutboundStateService.markAborted = async () => undefined;
    });

    afterEach(() => {
        const { ReservaHospedagem } = require('../../../models/ReservaHospedagem');
        const { HospedinOutboundSyncState } = require('../../../models/HospedinOutboundSyncState');
        const { hospedinOutboundStateService } = require('./HospedinOutboundStateService');

        ReservaHospedagem.findByPk = originalFindByPk;
        HospedinOutboundSyncState.findByPk = originalSyncFindByPk;
        hospedinOutboundStateService.markSynced = originalMarkSynced;
        hospedinOutboundStateService.markWaitRetry = originalMarkWaitRetry;
        hospedinOutboundStateService.markFailed = originalMarkFailed;
        hospedinOutboundStateService.markAborted = originalMarkAborted;

        delete (global as any).__testSuites;
        delete (global as any).__testReservaIdExterno;
        delete (global as any).__testStateOverrides;
        delete (global as any).__remoteStatusById;
    });

    function buildService() {
        const reservationService: Pick<
            HospedinReservationService,
            'getReservationDto' | 'cancelReservation'
        > = {
            async getReservationDto(reservationId) {
                getCalls.push(String(reservationId));
                if ((global as any).__getErrorById?.[String(reservationId)]) {
                    throw (global as any).__getErrorById[String(reservationId)];
                }
                const remoteStatusById =
                    ((global as any).__remoteStatusById as Record<
                        string,
                        string
                    >) ?? {};
                const status =
                    remoteStatusById[String(reservationId)] ?? 'reservation';
                return { reservationId: String(reservationId), status } as any;
            },
            async cancelReservation(reservationId, patch) {
                patchCalls.push(String(reservationId));
                if ((global as any).__patchErrorById?.[String(reservationId)]) {
                    throw (global as any).__patchErrorById[String(reservationId)];
                }
                return {
                    reservationId: String(reservationId),
                    status: 'canceled',
                } as any;
            },
        };

        return new HospedinOutboundCancelService(
            reservationService as HospedinReservationService
        );
    }

    it('TESTE 1 — 1 suíte legado com idExterno → 1 PATCH', async () => {
        (global as any).__testSuites = [
            suiteLine({ id: 10, hospedinReservationId: null }),
        ];
        (global as any).__testReservaIdExterno = '111';

        const service = buildService();
        const result = await service.cancel(stateBase);

        assert.equal(result.outcome, 'cancelled');
        assert.deepEqual(getCalls, ['111']);
        assert.deepEqual(patchCalls, ['111']);
    });

    it('TESTE 2 — 2 suítes 111 e 222 → 2 PATCH', async () => {
        (global as any).__testSuites = [
            suiteLine({ id: 10, hospedinReservationId: '111' }),
            suiteLine({ id: 11, hospedinReservationId: '222' }),
        ];

        const service = buildService();
        const result = await service.cancel(stateBase);

        assert.equal(result.outcome, 'cancelled');
        assert.deepEqual(getCalls, ['111', '222']);
        assert.deepEqual(patchCalls, ['111', '222']);
    });

    it('TESTE 3 — A=111, B=NULL → somente 111', async () => {
        (global as any).__testSuites = [
            suiteLine({ id: 10, hospedinReservationId: '111' }),
            suiteLine({ id: 11, hospedinReservationId: null }),
        ];

        const service = buildService();
        const result = await service.cancel(stateBase);

        assert.equal(result.outcome, 'cancelled');
        assert.deepEqual(patchCalls, ['111']);
    });

    it('TESTE 4 — A=111, B=222 e idExterno=111 → Set evita PATCH duplicado', async () => {
        (global as any).__testSuites = [
            suiteLine({ id: 10, hospedinReservationId: '111' }),
            suiteLine({ id: 11, hospedinReservationId: '222' }),
        ];
        (global as any).__testReservaIdExterno = '111';

        const service = buildService();
        await service.cancel(stateBase);

        assert.deepEqual(patchCalls, ['111', '222']);
        assert.equal(patchCalls.length, 2);
    });

    it('TESTE 5 — uma já canceled e outra ativa', async () => {
        (global as any).__testSuites = [
            suiteLine({ id: 10, hospedinReservationId: '111' }),
            suiteLine({ id: 11, hospedinReservationId: '222' }),
        ];
        (global as any).__remoteStatusById = {
            '111': 'canceled',
            '222': 'reservation',
        };

        const service = buildService();
        const result = await service.cancel(stateBase);

        assert.equal(result.outcome, 'cancelled');
        assert.deepEqual(patchCalls, ['222']);
    });

    it('TESTE 6 — GET 404 → FAILED permanente', async () => {
        (global as any).__testSuites = [
            suiteLine({ id: 10, hospedinReservationId: '111' }),
        ];
        (global as any).__getErrorById = {
            '111': new HospedinApiError('not found', 404, null),
        };

        const service = buildService();
        const result = await service.cancel(stateBase);

        assert.equal(result.outcome, 'failed');
        assert.equal(markFailedCalls.at(-1)?.errorCode, 'RESERVATION_NOT_FOUND');
        assert.equal(markWaitRetryCalls, 0);
    });

    it('TESTE 7 — PATCH 409 → FAILED', async () => {
        (global as any).__testSuites = [
            suiteLine({ id: 10, hospedinReservationId: '111' }),
        ];
        (global as any).__patchErrorById = {
            '111': new HospedinApiError('conflict', 409, null),
        };

        const service = buildService();
        const result = await service.cancel(stateBase);

        assert.equal(result.outcome, 'failed');
        assert.equal(markFailedCalls.at(-1)?.errorCode, 'HTTP_409');
    });

    it('TESTE 8 — 111 ok e 222 com 429 → WAIT_RETRY', async () => {
        (global as any).__testSuites = [
            suiteLine({ id: 10, hospedinReservationId: '111' }),
            suiteLine({ id: 11, hospedinReservationId: '222' }),
        ];
        (global as any).__patchErrorById = {
            '222': new HospedinApiError('rate', 429, null),
        };

        const service = buildService();
        const first = await service.cancel(stateBase);

        assert.equal(first.outcome, 'retry');
        assert.equal(markWaitRetryCalls, 1);
        assert.deepEqual(patchCalls, ['111', '222']);

        patchCalls = [];
        getCalls = [];
        delete (global as any).__patchErrorById;
        (global as any).__remoteStatusById = { '111': 'canceled' };

        const second = await service.cancel(stateBase);
        assert.equal(second.outcome, 'cancelled');
        assert.deepEqual(getCalls, ['111', '222']);
        assert.deepEqual(patchCalls, ['222']);
    });

    it('TESTE 11 — legado 1 suíte somente idExterno', async () => {
        (global as any).__testSuites = [
            suiteLine({ id: 10, hospedinReservationId: null }),
        ];
        (global as any).__testReservaIdExterno = '999';

        const service = buildService();
        const result = await service.cancel(stateBase);

        assert.equal(result.outcome, 'cancelled');
        assert.deepEqual(patchCalls, ['999']);
    });

    it('todas já canceladas → idempotent', async () => {
        (global as any).__testSuites = [
            suiteLine({ id: 10, hospedinReservationId: '111' }),
            suiteLine({ id: 11, hospedinReservationId: '222' }),
        ];
        (global as any).__remoteStatusById = {
            '111': 'canceled',
            '222': 'canceled',
        };

        const service = buildService();
        const result = await service.cancel(stateBase);

        assert.equal(result.outcome, 'idempotent');
        assert.equal(patchCalls.length, 0);
        assert.equal(markSyncedCalls.length, 1);
    });
});
