/**
 * Testes — PATCH administrativo de alteração de período Jango → Hospedin.
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/services/hospedinAdminPeriodoTrocaPushService.test.ts
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { formatOutboundCheckDatetime } from '../outbound/HospedinOutboundPayloadBuilder';
import type { HospedinReservationService } from './HospedinReservationService';
import { pushAdminPeriodoTrocaToHospedin } from './hospedinAdminPeriodoTrocaPushService';

function suiteLine(partial: {
    id: number;
    idEventoSuite: number;
    hospedinReservationId?: string | null;
}) {
    return {
        id: partial.id,
        idEventoSuite: partial.idEventoSuite,
        adultos: 2,
        criancas: 0,
        hospedinReservationId: partial.hospedinReservationId ?? null,
    };
}

function buildMockReservationService(
    onUpdate?: (reservationId: string, patch: Record<string, unknown>) => void,
    options?: { failForId?: string; failMessage?: string }
): HospedinReservationService {
    return {
        updateReservation: async (reservationId, patch) => {
            const id = String(reservationId);
            if (options?.failForId && id === options.failForId) {
                throw new Error(options.failMessage || 'API error');
            }
            onUpdate?.(id, patch as Record<string, unknown>);
            return {} as any;
        },
    } as HospedinReservationService;
}

describe('hospedinAdminPeriodoTrocaPushService', () => {
    afterEach(() => {
        // no mocks to restore
    });

    const checkinNovo = new Date('2026-10-10T20:00:00.000Z');
    const checkoutNovo = new Date('2026-10-11T17:00:00.000Z');

    it('TESTE 1 — origem diferente de HOSPEDIN: não envia PATCH', async () => {
        const calls: Array<{ id: string; patch: Record<string, unknown> }> =
            [];
        const service = buildMockReservationService((id, patch) => {
            calls.push({ id, patch });
        });

        const result = await pushAdminPeriodoTrocaToHospedin(
            {
                reserva: {
                    id: 50,
                    origemReserva: 'ATENDENTE',
                    idExterno: '30295972',
                    ReservaSuite: [
                        suiteLine({
                            id: 10,
                            idEventoSuite: 5,
                            hospedinReservationId: '30295972',
                        }),
                    ],
                } as any,
                checkin: checkinNovo,
                checkout: checkoutNovo,
            },
            service
        );

        assert.equal(result.patched, false);
        assert.equal(result.skipped, 'NOT_HOSPEDIN_ORIGIN');
        assert.equal(calls.length, 0);
    });

    it('TESTE 2 — origem HOSPEDIN: monta PATCH de período', async () => {
        const calls: Array<{ id: string; patch: Record<string, unknown> }> =
            [];
        const service = buildMockReservationService((id, patch) => {
            calls.push({ id, patch });
        });

        const result = await pushAdminPeriodoTrocaToHospedin(
            {
                reserva: {
                    id: 46,
                    origemReserva: 'HOSPEDIN',
                    idExterno: '29682746',
                    ReservaSuite: [
                        suiteLine({
                            id: 46,
                            idEventoSuite: 13,
                            hospedinReservationId: null,
                        }),
                    ],
                } as any,
                checkin: checkinNovo,
                checkout: checkoutNovo,
            },
            service
        );

        assert.equal(result.patched, true);
        assert.deepEqual(result.hospedinReservationIds, ['29682746']);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].id, '29682746');
        assert.equal(Object.keys(calls[0].patch).length, 2);
        assert.ok(calls[0].patch.check_in);
        assert.ok(calls[0].patch.check_out);
        assert.equal(
            calls[0].patch.place_id,
            undefined,
            'não deve alterar suíte'
        );
        assert.equal(
            calls[0].patch.total_amount,
            undefined,
            'não deve alterar tarifa'
        );
    });

    it('TESTE 3 — resolve hospedinReservationId via idExterno (caso produção #46)', async () => {
        const calls: string[] = [];
        const service = buildMockReservationService((id) => {
            calls.push(id);
        });

        await pushAdminPeriodoTrocaToHospedin(
            {
                reserva: {
                    id: 46,
                    origemReserva: 'HOSPEDIN',
                    idExterno: '29682746',
                    ReservaSuite: [
                        suiteLine({
                            id: 46,
                            idEventoSuite: 13,
                        }),
                    ],
                } as any,
                checkin: checkinNovo,
                checkout: checkoutNovo,
            },
            service
        );

        assert.deepEqual(calls, ['29682746']);
    });

    it('TESTE 4 — envia check_in formatado corretamente', async () => {
        const calls: Array<Record<string, unknown>> = [];
        const service = buildMockReservationService((_id, patch) => {
            calls.push(patch);
        });

        await pushAdminPeriodoTrocaToHospedin(
            {
                reserva: {
                    id: 46,
                    origemReserva: 'HOSPEDIN',
                    idExterno: '29682746',
                    ReservaSuite: [suiteLine({ id: 46, idEventoSuite: 13 })],
                } as any,
                checkin: checkinNovo,
                checkout: checkoutNovo,
            },
            service
        );

        assert.equal(
            calls[0].check_in,
            formatOutboundCheckDatetime(checkinNovo)
        );
        assert.match(String(calls[0].check_in), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it('TESTE 5 — envia check_out formatado corretamente', async () => {
        const calls: Array<Record<string, unknown>> = [];
        const service = buildMockReservationService((_id, patch) => {
            calls.push(patch);
        });

        await pushAdminPeriodoTrocaToHospedin(
            {
                reserva: {
                    id: 46,
                    origemReserva: 'HOSPEDIN',
                    idExterno: '29682746',
                    ReservaSuite: [suiteLine({ id: 46, idEventoSuite: 13 })],
                } as any,
                checkin: checkinNovo,
                checkout: checkoutNovo,
            },
            service
        );

        assert.equal(
            calls[0].check_out,
            formatOutboundCheckDatetime(checkoutNovo)
        );
    });

    it('TESTE 6 — utiliza formatter existente (sem campos extras)', async () => {
        const calls: Array<Record<string, unknown>> = [];
        const service = buildMockReservationService((_id, patch) => {
            calls.push(patch);
        });

        await pushAdminPeriodoTrocaToHospedin(
            {
                reserva: {
                    id: 46,
                    origemReserva: 'HOSPEDIN',
                    idExterno: '29682746',
                    ReservaSuite: [suiteLine({ id: 46, idEventoSuite: 13 })],
                } as any,
                checkin: checkinNovo,
                checkout: checkoutNovo,
            },
            service
        );

        assert.deepEqual(calls[0], {
            check_in: formatOutboundCheckDatetime(checkinNovo),
            check_out: formatOutboundCheckDatetime(checkoutNovo),
        });
    });

    it('TESTE 7 — erro da API Hospedin propaga CustomError 502', async () => {
        const service = buildMockReservationService(undefined, {
            failForId: '29682746',
            failMessage: 'HTTP 422 Unprocessable',
        });

        await assert.rejects(
            () =>
                pushAdminPeriodoTrocaToHospedin(
                    {
                        reserva: {
                            id: 46,
                            origemReserva: 'HOSPEDIN',
                            idExterno: '29682746',
                            ReservaSuite: [
                                suiteLine({ id: 46, idEventoSuite: 13 }),
                            ],
                        } as any,
                        checkin: checkinNovo,
                        checkout: checkoutNovo,
                    },
                    service
                ),
            (err: any) => {
                assert.equal(err.statusCode, 502);
                assert.equal(err.code, 'HOSPEDIN_PERIODO_PATCH_FAILED');
                assert.match(
                    String(err.message),
                    /falha ao sincronizar com o Hospedin/i
                );
                return true;
            }
        );
    });

    it('TESTE 8 — multi-suíte: PATCH em cada reservation distinta', async () => {
        const calls: Array<{ id: string; patch: Record<string, unknown> }> =
            [];
        const service = buildMockReservationService((id, patch) => {
            calls.push({ id, patch });
        });

        const result = await pushAdminPeriodoTrocaToHospedin(
            {
                reserva: {
                    id: 200,
                    origemReserva: 'HOSPEDIN',
                    idExterno: null,
                    ReservaSuite: [
                        suiteLine({
                            id: 10,
                            idEventoSuite: 5,
                            hospedinReservationId: '111',
                        }),
                        suiteLine({
                            id: 11,
                            idEventoSuite: 4,
                            hospedinReservationId: '222',
                        }),
                    ],
                } as any,
                checkin: checkinNovo,
                checkout: checkoutNovo,
            },
            service
        );

        assert.equal(result.patched, true);
        assert.equal(calls.length, 2);
        assert.deepEqual(
            calls.map((c) => c.id).sort(),
            ['111', '222']
        );
        for (const call of calls) {
            assert.equal(call.patch.check_in, formatOutboundCheckDatetime(checkinNovo));
            assert.equal(call.patch.check_out, formatOutboundCheckDatetime(checkoutNovo));
        }
    });

    it('TESTE 9 — sem vínculo Hospedin: erro 502 HOSPEDIN_RESERVATION_ID_MISSING', async () => {
        const service = buildMockReservationService();

        await assert.rejects(
            () =>
                pushAdminPeriodoTrocaToHospedin(
                    {
                        reserva: {
                            id: 99,
                            origemReserva: 'HOSPEDIN',
                            idExterno: null,
                            ReservaSuite: [
                                suiteLine({ id: 1, idEventoSuite: 3 }),
                            ],
                        } as any,
                        checkin: checkinNovo,
                        checkout: checkoutNovo,
                    },
                    service
                ),
            (err: any) => {
                assert.equal(err.statusCode, 502);
                assert.equal(err.code, 'HOSPEDIN_RESERVATION_ID_MISSING');
                return true;
            }
        );
    });
});
