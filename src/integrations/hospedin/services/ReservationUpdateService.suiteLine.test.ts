/**
 * Testes — ReservationUpdateService resolve linha por hospedinReservationId.
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/services/ReservationUpdateService.suiteLine.test.ts
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import connection from '../../../database';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaHospede } from '../../../models/ReservaHospede';
import * as reservaSuiteService from '../../../services/reservaSuiteService';
import * as hospedagemRefreshVersionService from '../../../services/hospedagemRefreshVersionService';
import { HospedinDomainMappingError } from '../mapper/HospedinReservationDomainMapper';
import type { ReservationExecutionContext } from '../sync/types';
import { ReservationUpdateService } from './ReservationUpdateService';
import { reservationOriginEnrichmentService } from './ReservationOriginEnrichmentService';
import { guestCpfReconcileService } from './GuestCpfReconcileService';

function suiteRow(partial: {
    id: number;
    idEventoSuite: number;
    hospedinReservationId?: string | null;
    adultos?: number;
    criancas?: number;
}) {
    const row: Record<string, unknown> = {
        id: partial.id,
        idEventoSuite: partial.idEventoSuite,
        adultos: partial.adultos ?? 2,
        criancas: partial.criancas ?? 0,
        hospedinReservationId: partial.hospedinReservationId ?? null,
        ReservaHospede: [{ id: 1, nome: 'Walter', tipo: 'Adulto' }],
        update: async (patch: Record<string, unknown>) => {
            if (patch.idEventoSuite != null) {
                row.idEventoSuite = patch.idEventoSuite;
            }
            return patch;
        },
    };
    return row;
}

function buildCtx(reservationId: number): ReservationExecutionContext {
    return {
        decision: {
            reservationId,
            action: 'UPDATE',
            reason: 'test',
        },
        syncState: {
            internal_entity_id: '300',
        } as any,
        stagingReservation: {} as any,
        resolvedSuite: {
            found: true,
            idEventoSuite: 5,
            placeId: 501,
        } as any,
        correlationId: 'corr-test',
    };
}

function setupHospedagem(suiteLines: ReturnType<typeof suiteRow>[]) {
    const hospedagem = {
        id: 300,
        origemReserva: 'HOSPEDIN',
        checkin: new Date('2026-09-12T16:00:00-04:00'),
        checkout: new Date('2026-09-13T13:00:00-04:00'),
        valorTotal: 500,
        valorPago: 500,
        saldoPendente: 0,
        noites: 1,
        observacaoImportada: 'obs',
        observacaoOperador: null,
        observacoes: 'obs',
        idUsuario: 1,
        reload: async () => undefined,
        update: async () => undefined,
        ReservaSuite: suiteLines,
    };

    mock.method(ReservaHospedagem, 'findByPk', async () => hospedagem);
    mock.method(ReservaHospede, 'findAll', async () => []);
    mock.method(connection, 'transaction', async (fn: (t: unknown) => Promise<unknown>) =>
        fn({})
    );
    mock.method(
        reservationOriginEnrichmentService,
        'enrichFromHospedinStaging',
        async () => undefined
    );
    mock.method(
        hospedagemRefreshVersionService,
        'incrementarHospedagemRefreshVersion',
        async () => undefined
    );
    mock.method(
        guestCpfReconcileService,
        'upgradeReservationFromDocuments',
        async () => undefined
    );
    mock.method(reservaSuiteService, 'suiteTemConflito', async () => false);

    return hospedagem;
}

describe('ReservationUpdateService — linha por hospedinReservationId', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('TESTE 4 — inbound multi-suíte atualiza linha do hospedinReservationId correto', async () => {
        const line1 = suiteRow({
            id: 10,
            idEventoSuite: 5,
            hospedinReservationId: '111',
        });
        const line2 = suiteRow({
            id: 11,
            idEventoSuite: 4,
            hospedinReservationId: '222',
        });
        setupHospedagem([line1, line2]);

        const service = new ReservationUpdateService();
        const result = await service.updateFromHospedin(buildCtx(222), {
            checkin: new Date('2026-09-12T16:00:00-04:00'),
            checkout: new Date('2026-09-13T13:00:00-04:00'),
            idEventoSuite: 7,
            observacoes: 'obs',
            adultos: 2,
            criancas: 0,
            hospedes: [{ nome: 'Walter', tipo: 'Adulto', dataNascimento: null }],
        });

        assert.equal(result.applied, true);
        assert.equal(line2.idEventoSuite, 7);
        assert.equal(line1.idEventoSuite, 5);
    });

    it('TESTE 5 — após troca alinhada (Jango=5, Hospedin=5) inbound não reverte', async () => {
        const line1 = suiteRow({
            id: 10,
            idEventoSuite: 5,
            hospedinReservationId: '111',
        });
        setupHospedagem([line1]);

        const service = new ReservationUpdateService();
        const result = await service.updateFromHospedin(buildCtx(111), {
            checkin: new Date('2026-09-12T16:00:00-04:00'),
            checkout: new Date('2026-09-13T13:00:00-04:00'),
            idEventoSuite: 5,
            observacoes: 'obs',
            adultos: 2,
            criancas: 0,
            hospedes: [{ nome: 'Walter', tipo: 'Adulto', dataNascimento: null }],
        });

        assert.equal(result.applied, false);
        assert.equal(line1.idEventoSuite, 5);
    });

    it('multi-suíte sem match de hospedinReservationId falha com SUITE_LINE_NOT_FOUND', async () => {
        setupHospedagem([
            suiteRow({
                id: 10,
                idEventoSuite: 5,
                hospedinReservationId: '111',
            }),
            suiteRow({
                id: 11,
                idEventoSuite: 4,
                hospedinReservationId: '222',
            }),
        ]);

        const service = new ReservationUpdateService();
        await assert.rejects(
            () =>
                service.updateFromHospedin(buildCtx(999), {
                    checkin: new Date('2026-09-12T16:00:00-04:00'),
                    checkout: new Date('2026-09-13T13:00:00-04:00'),
                    idEventoSuite: 7,
                    observacoes: 'obs',
                    adultos: 2,
                    criancas: 0,
                    hospedes: [],
                }),
            (err: unknown) =>
                err instanceof HospedinDomainMappingError &&
                err.code === 'SUITE_LINE_NOT_FOUND'
        );
    });
});
