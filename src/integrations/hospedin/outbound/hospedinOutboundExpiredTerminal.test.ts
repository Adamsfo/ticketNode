/**
 * Expirada no CREATE outbound — ABORTED + STATUS_TERMINAL (sem banco).
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/hospedinOutboundExpiredTerminal.test.ts
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundStatus,
} from '../../../models/HospedinOutboundSyncState';
import { StatusReservaHospedagem } from '../../../models/ReservaHospedagem';
import { HospedinOutboundCreateService } from './HospedinOutboundCreateService';
import { outboundEnqueueTestHelpers } from './HospedinOutboundEnqueueService';
import { isOutboundExpiredTerminalBusinessSkip } from './hospedinOutboundExecutionFailureDetails';
import {
    avaliarOutboundReativacao,
} from '../../../services/hospedagemReativacaoAdminPolicy';

describe('isOutboundExpiredTerminalBusinessSkip', () => {
    it('aborted + STATUS_TERMINAL → skip de falha técnica', () => {
        assert.equal(
            isOutboundExpiredTerminalBusinessSkip({
                outcome: 'aborted',
                errorCode: 'STATUS_TERMINAL',
            }),
            true
        );
    });

    it('aborted + CREATE_ABORTED → não é skip de expiração', () => {
        assert.equal(
            isOutboundExpiredTerminalBusinessSkip({
                outcome: 'aborted',
                errorCode: 'CREATE_ABORTED',
            }),
            false
        );
    });

    it('failed + STATUS_TERMINAL → não é skip de expiração', () => {
        assert.equal(
            isOutboundExpiredTerminalBusinessSkip({
                outcome: 'failed',
                errorCode: 'STATUS_TERMINAL',
            }),
            false
        );
    });
});

describe('shouldSkipMarkDirty — ABORTED diferenciado', () => {
    it('ABORTED + STATUS_TERMINAL + Expirada → skip', () => {
        assert.equal(
            outboundEnqueueTestHelpers.shouldSkipMarkDirty(
                { status: StatusReservaHospedagem.Expirada } as any,
                {
                    outbound_status: HospedinOutboundStatus.ABORTED,
                    error_code: 'STATUS_TERMINAL',
                } as any
            ),
            true
        );
    });

    it('ABORTED + STATUS_TERMINAL + AguardandoPagamento → permite markDirty', () => {
        assert.equal(
            outboundEnqueueTestHelpers.shouldSkipMarkDirty(
                {
                    status: StatusReservaHospedagem.AguardandoPagamento,
                } as any,
                {
                    outbound_status: HospedinOutboundStatus.ABORTED,
                    error_code: 'STATUS_TERMINAL',
                } as any
            ),
            false
        );
    });

    it('ABORTED + STATUS_TERMINAL + Confirmada → permite markDirty', () => {
        assert.equal(
            outboundEnqueueTestHelpers.shouldSkipMarkDirty(
                { status: StatusReservaHospedagem.Confirmada } as any,
                {
                    outbound_status: HospedinOutboundStatus.ABORTED,
                    error_code: 'STATUS_TERMINAL',
                } as any
            ),
            false
        );
    });

    it('resolveNextQueueState reabre para PENDING_CREATE após expiração', () => {
        const next = outboundEnqueueTestHelpers.resolveNextQueueState({
            neverSent: true,
            existing: {
                outbound_status: HospedinOutboundStatus.ABORTED,
                error_code: 'STATUS_TERMINAL',
            } as any,
            preconditions: { ok: true, errorCode: null, lastError: null },
        });
        assert.equal(next.outbound_status, HospedinOutboundStatus.PENDING_CREATE);
        assert.equal(next.desired_action, HospedinOutboundDesiredAction.CREATE);
    });

    it('ABORTED + OUTBOUND_OPERATIONAL_WINDOW → não skip', () => {
        assert.equal(
            outboundEnqueueTestHelpers.shouldSkipMarkDirty(
                { status: StatusReservaHospedagem.Confirmada } as any,
                {
                    outbound_status: HospedinOutboundStatus.ABORTED,
                    error_code: 'OUTBOUND_OPERATIONAL_WINDOW',
                    desired_action: HospedinOutboundDesiredAction.CREATE,
                } as any
            ),
            false
        );
    });

    it('ABORTED + CREATE_ABORTED + Confirmada → skip (cancelamento)', () => {
        assert.equal(
            outboundEnqueueTestHelpers.shouldSkipMarkDirty(
                { status: StatusReservaHospedagem.Confirmada } as any,
                {
                    outbound_status: HospedinOutboundStatus.ABORTED,
                    error_code: 'CREATE_ABORTED',
                    desired_action: HospedinOutboundDesiredAction.CANCEL,
                } as any
            ),
            true
        );
    });
});

describe('avaliarOutboundReativacao — ABORTED diferenciado', () => {
    it('ABORTED + STATUS_TERMINAL → não bloqueia por outbound', () => {
        const resultado = avaliarOutboundReativacao({
            origemReserva: 'CLIENTE',
            eventoTipo: 'Pousada',
            suites: [{ hospedinReservationId: null }],
            outboundState: {
                outbound_status: HospedinOutboundStatus.ABORTED,
                desired_action: 'CREATE',
                last_error: 'Status Expirada não elegível para CREATE outbound.',
                error_code: 'STATUS_TERMINAL',
            },
        });
        assert.deepEqual(resultado, { ok: true, deveMarkDirty: true });
    });

    it('ABORTED + OUTBOUND_OPERATIONAL_WINDOW → permite reativação', () => {
        const resultado = avaliarOutboundReativacao({
            origemReserva: 'CLIENTE',
            eventoTipo: 'Pousada',
            suites: [{ hospedinReservationId: null }],
            outboundState: {
                outbound_status: HospedinOutboundStatus.ABORTED,
                desired_action: 'CREATE',
                last_error: 'janela',
                error_code: 'OUTBOUND_OPERATIONAL_WINDOW',
            },
        });
        assert.deepEqual(resultado, { ok: true, deveMarkDirty: true });
    });

    it('ABORTED + CREATE_ABORTED → continua bloqueando', () => {
        const resultado = avaliarOutboundReativacao({
            origemReserva: 'CLIENTE',
            eventoTipo: 'Pousada',
            suites: [{ hospedinReservationId: null }],
            outboundState: {
                outbound_status: HospedinOutboundStatus.ABORTED,
                desired_action: 'CREATE',
                last_error: 'abort',
                error_code: 'CREATE_ABORTED',
            },
        });
        assert.equal(resultado.ok, false);
    });
});

describe('HospedinOutboundCreateService — Expirada', () => {
    let markAbortedCalls: Array<{ errorCode?: string | null }>;
    let markFailedCalls: number;
    let originalFindByPk: typeof import('../../../models/ReservaHospedagem').ReservaHospedagem.findByPk;
    let originalMarkAborted: typeof import('./HospedinOutboundStateService').hospedinOutboundStateService.markAborted;
    let originalMarkFailed: typeof import('./HospedinOutboundStateService').hospedinOutboundStateService.markFailed;

    beforeEach(() => {
        markAbortedCalls = [];
        markFailedCalls = 0;
        const { ReservaHospedagem } = require('../../../models/ReservaHospedagem');
        const { hospedinOutboundStateService } = require('./HospedinOutboundStateService');
        originalFindByPk = ReservaHospedagem.findByPk;
        originalMarkAborted = hospedinOutboundStateService.markAborted;
        originalMarkFailed = hospedinOutboundStateService.markFailed;

        ReservaHospedagem.findByPk = async () => ({
            id: 999,
            status: StatusReservaHospedagem.Expirada,
            checkin: new Date('2026-10-10'),
            checkout: new Date('2026-10-12'),
            ReservaSuite: [],
        });

        hospedinOutboundStateService.markAborted = async (
            _id: number,
            input: { errorCode?: string | null }
        ) => {
            markAbortedCalls.push(input);
        };
        hospedinOutboundStateService.markFailed = async () => {
            markFailedCalls += 1;
        };
    });

    afterEach(() => {
        const { ReservaHospedagem } = require('../../../models/ReservaHospedagem');
        const { hospedinOutboundStateService } = require('./HospedinOutboundStateService');
        ReservaHospedagem.findByPk = originalFindByPk;
        hospedinOutboundStateService.markAborted = originalMarkAborted;
        hospedinOutboundStateService.markFailed = originalMarkFailed;
    });

    it('Expirada → ABORTED + STATUS_TERMINAL (não markFailed)', async () => {
        const service = new HospedinOutboundCreateService();
        const result = await service.create({
            id: 1,
            id_reserva_hospedagem: 999,
            desired_action: HospedinOutboundDesiredAction.CREATE,
        } as any);

        assert.equal(markFailedCalls, 0);
        assert.equal(markAbortedCalls.length, 1);
        assert.equal(markAbortedCalls[0]?.errorCode, 'STATUS_TERMINAL');
        assert.equal(result.outcome, 'aborted');
        assert.equal(result.errorCode, 'STATUS_TERMINAL');
        assert.match(String(result.message || ''), /Expirada/);
    });
});
