/**
 * Testes — PATCH administrativo de troca de suíte Jango → Hospedin.
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/services/hospedinAdminSuiteTrocaPushService.test.ts
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { HospedinPlace } from '../../../models/HospedinPlace';
import { PlaceSuiteMappingStatus } from '../../../models/HospedinPlaceSuiteMap';
import { hospedinPlaceSuiteMapService } from '../services/HospedinPlaceSuiteMapService';
import type { HospedinReservationService } from './HospedinReservationService';
import {
    isHospedinOriginReserva,
    pushAdminSuiteTrocaToHospedin,
} from './hospedinAdminSuiteTrocaPushService';
import { isOriginEligibleForOutbound } from '../outbound/hospedinOutboundOrigin';

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
    onUpdate?: (reservationId: string, patch: Record<string, unknown>) => void
): HospedinReservationService {
    return {
        updateReservation: async (reservationId, patch) => {
            onUpdate?.(String(reservationId), patch as Record<string, unknown>);
            return {} as any;
        },
    } as HospedinReservationService;
}

function mockPlaceMapping(
    placeIdBySuite: Record<number, number>,
    placeTypeId = 131939
) {
    mock.method(
        hospedinPlaceSuiteMapService,
        'findByEventoSuiteId',
        async (idEventoSuite: number) => {
            const placeId = placeIdBySuite[idEventoSuite];
            if (!placeId) return null;
            return {
                ativo: true,
                mapping_status: PlaceSuiteMappingStatus.LINKED,
                place_id: placeId,
            } as any;
        }
    );
    mock.method(HospedinPlace, 'findOne', async () =>
        ({ place_type_id: placeTypeId }) as any
    );
}

describe('hospedinAdminSuiteTrocaPushService', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('TESTE 1 — origem Jango: não envia PATCH (outbound geral segue via markDirty)', async () => {
        const calls: Array<{ id: string; patch: Record<string, unknown> }> =
            [];
        const service = buildMockReservationService((id, patch) => {
            calls.push({ id, patch });
        });

        const result = await pushAdminSuiteTrocaToHospedin(
            {
                reserva: {
                    id: 50,
                    origemReserva: 'RECEPCAO',
                    idExterno: '30295972',
                    ReservaSuite: [
                        suiteLine({
                            id: 10,
                            idEventoSuite: 5,
                            hospedinReservationId: '30295972',
                        }),
                    ],
                } as any,
                linhaTrocada: suiteLine({
                    id: 10,
                    idEventoSuite: 5,
                    hospedinReservationId: '30295972',
                }) as any,
                idEventoSuiteOrigem: 3,
                idEventoSuiteDestino: 5,
            },
            service
        );

        assert.equal(result.patched, false);
        assert.equal(result.skipped, 'NOT_HOSPEDIN_ORIGIN');
        assert.equal(calls.length, 0);
        assert.equal(
            isOriginEligibleForOutbound({
                origemReserva: 'RECEPCAO',
                Evento: { tipo: 'Pousada' },
            }),
            true
        );
    });

    it('TESTE 2 — origem HOSPEDIN, uma suíte: PATCH com place_id/place_type_id', async () => {
        const calls: Array<{ id: string; patch: Record<string, unknown> }> =
            [];
        const service = buildMockReservationService((id, patch) => {
            calls.push({ id, patch });
        });

        mockPlaceMapping({ 5: 445906 });

        const result = await pushAdminSuiteTrocaToHospedin(
            {
                reserva: {
                    id: 100,
                    origemReserva: 'HOSPEDIN',
                    idExterno: '304111',
                    ReservaSuite: [
                        suiteLine({
                            id: 10,
                            idEventoSuite: 5,
                            hospedinReservationId: '304111',
                        }),
                    ],
                } as any,
                linhaTrocada: suiteLine({
                    id: 10,
                    idEventoSuite: 5,
                    hospedinReservationId: '304111',
                }) as any,
                idEventoSuiteOrigem: 3,
                idEventoSuiteDestino: 5,
            },
            service
        );

        assert.equal(result.patched, true);
        assert.equal(result.hospedinReservationId, '304111');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].id, '304111');
        assert.equal(calls[0].patch.place_id, 445906);
        assert.equal(calls[0].patch.place_type_id, 131939);
    });

    it('TESTE 3 — origem HOSPEDIN, duas suítes: PATCH só na linha trocada', async () => {
        const calls: Array<{ id: string; patch: Record<string, unknown> }> =
            [];
        const service = buildMockReservationService((id, patch) => {
            calls.push({ id, patch });
        });

        mockPlaceMapping({ 5: 501, 4: 502 });

        const result = await pushAdminSuiteTrocaToHospedin(
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
                linhaTrocada: suiteLine({
                    id: 10,
                    idEventoSuite: 5,
                    hospedinReservationId: '111',
                }) as any,
                idEventoSuiteOrigem: 3,
                idEventoSuiteDestino: 5,
            },
            service
        );

        assert.equal(result.patched, true);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].id, '111');
        assert.equal(calls[0].patch.place_id, 501);
        assert.ok(!calls.some((c) => c.id === '222'));
    });

    it('TESTE 6 — HOSPEDIN continua bloqueado para outbound geral', () => {
        assert.equal(isHospedinOriginReserva('HOSPEDIN'), true);
        assert.equal(
            isOriginEligibleForOutbound({
                origemReserva: 'HOSPEDIN',
                Evento: { tipo: 'Pousada' },
            }),
            false
        );
    });
});
