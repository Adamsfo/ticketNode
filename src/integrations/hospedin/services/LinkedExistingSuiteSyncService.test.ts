/**
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/services/LinkedExistingSuiteSyncService.test.ts
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import connection from '../../../database';
import { HospedinReservation } from '../../../models/HospedinReservation';
import { PagamentoHospedagem } from '../../../models/PagamentoHospedagem';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import * as reservaSuiteService from '../../../services/reservaSuiteService';
import * as hospedagemRefreshVersionService from '../../../services/hospedagemRefreshVersionService';
import { placeSuiteResolver } from './PlaceSuiteResolver';
import { linkedExistingSuiteSyncService } from './LinkedExistingSuiteSyncService';

const RESERVATION_ID = 30328851;
const ID_RESERVA = 66;

function baseStaging(overrides: Record<string, unknown> = {}) {
    return {
        reservation_id: RESERVATION_ID,
        status: 'reservation',
        checkin: new Date('2026-09-06T17:00:00.000Z'),
        checkout: new Date('2026-09-07T15:00:00.000Z'),
        payload_json: {
            id: RESERVATION_ID,
            place_id: 445912,
            searchable_code: 'HO:001333',
            total_amount: 100000,
            note: 'Nota Hospedin',
            ...overrides,
        },
    };
}

function baseResolver(idEventoSuite = 17) {
    return {
        found: true,
        status: 'LINKED',
        placeId: 445912,
        idEventoSuite,
        idEvento: 1,
        mapId: 1,
        mappedAt: new Date(),
        mappedBy: null,
    };
}

function baseHospedagem(overrides: Record<string, unknown> = {}, linhaOverrides: Record<string, unknown> = {}) {
    const linha = {
        id: 100,
        idEventoSuite: 17,
        valorTotal: 1000,
        preco: 1000,
        valorFinal: 1000,
        descontoTipo: null,
        descontoValor: null,
        update: mock.fn(async () => undefined),
        ...linhaOverrides,
    };

    const hospedagem = {
        id: ID_RESERVA,
        checkin: new Date('2026-09-06T17:00:00.000Z'),
        checkout: new Date('2026-09-07T15:00:00.000Z'),
        valorTotal: 1000,
        valorPago: 300,
        saldoPendente: 700,
        observacaoImportada: 'Reserva\nNota Hospedin',
        observacaoOperador: 'Obs operador local',
        observacoes: 'Reserva\nNota Hospedin\n\nObs operador local',
        update: mock.fn(async () => undefined),
        ReservaSuite: [linha],
        ...overrides,
    };

    return { hospedagem, linha };
}

function setupCommonMocks(
    stagingOverrides: Record<string, unknown> = {},
    hospedagemOverrides: Record<string, unknown> = {},
    linhaOverrides: Record<string, unknown> = {},
    options: { suiteConflito?: boolean } = {}
) {
    mock.method(HospedinReservation, 'findOne', async () =>
        baseStaging(stagingOverrides)
    );
    mock.method(placeSuiteResolver, 'resolveInternalSuite', async () =>
        baseResolver()
    );
    mock.method(
        reservaSuiteService,
        'suiteTemConflito',
        async () => options.suiteConflito === true
    );
    mock.method(
        hospedagemRefreshVersionService,
        'incrementarHospedagemRefreshVersion',
        async () => undefined
    );
    mock.method(connection, 'transaction', async (fn: (t: unknown) => Promise<void>) =>
        fn({})
    );

    const { hospedagem, linha } = baseHospedagem(
        hospedagemOverrides,
        linhaOverrides
    );
    mock.method(ReservaHospedagem, 'findByPk', async () => hospedagem);

    return { hospedagem, linha };
}

describe('LinkedExistingSuiteSyncService', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('1. atualiza somente suíte quando place_id diverge', async () => {
        const { hospedagem, linha } = setupCommonMocks({}, {}, { idEventoSuite: 16 });

        const result =
            await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
                reservationId: RESERVATION_ID,
                internalEntityId: ID_RESERVA,
            });

        assert.equal(result.applied, true);
        assert.equal(
            result.changes.some((c) => c.field === 'idEventoSuite'),
            true
        );
        assert.equal(
            result.changes.some((c) => c.field === 'valorTotal'),
            false
        );
        assert.equal(linha.update.mock.callCount(), 1);
        assert.deepEqual(linha.update.mock.calls[0].arguments[0], {
            idEventoSuite: 17,
        });
        assert.equal(hospedagem.update.mock.callCount(), 0);
    });

    it('2. atualiza somente valorTotal e saldoPendente quando total_amount diverge', async () => {
        const { hospedagem, linha } = setupCommonMocks(
            { total_amount: 120000 },
            { valorTotal: 1000, valorPago: 300, saldoPendente: 700 }
        );

        const result =
            await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
                reservationId: RESERVATION_ID,
                internalEntityId: ID_RESERVA,
            });

        assert.equal(result.applied, true);
        assert.deepEqual(
            result.changes.find((c) => c.field === 'valorTotal'),
            { field: 'valorTotal', before: 1000, after: 1200 }
        );
        assert.deepEqual(
            result.changes.find((c) => c.field === 'saldoPendente'),
            { field: 'saldoPendente', before: 700, after: 900 }
        );
        assert.equal(linha.update.mock.callCount(), 1);
        assert.deepEqual(linha.update.mock.calls[0].arguments[0], {
            valorTotal: 1200,
            preco: 1200,
            valorFinal: 1200,
        });
        assert.equal(hospedagem.update.mock.callCount(), 1);
        assert.deepEqual(hospedagem.update.mock.calls[0].arguments[0], {
            valorTotal: 1200,
            saldoPendente: 900,
        });
    });

    it('3. atualiza somente observacaoImportada quando note diverge', async () => {
        const { hospedagem, linha } = setupCommonMocks(
            { note: 'Nova nota importada' },
            {
                observacaoImportada: 'Reserva\nNota antiga',
                observacaoOperador: 'Obs operador local',
                observacoes: 'Reserva\nNota antiga\n\nObs operador local',
            }
        );

        const result =
            await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
                reservationId: RESERVATION_ID,
                internalEntityId: ID_RESERVA,
            });

        assert.equal(result.applied, true);
        const obsChange = result.changes.find(
            (c) => c.field === 'observacaoImportada'
        );
        assert.ok(obsChange);
        assert.equal(obsChange!.before, 'Reserva\nNota antiga');
        assert.equal(obsChange!.after, 'Reserva\nNova nota importada');
        assert.equal(linha.update.mock.callCount(), 0);
        assert.equal(hospedagem.update.mock.callCount(), 1);
        assert.equal(
            hospedagem.update.mock.calls[0].arguments[0].observacaoOperador,
            'Obs operador local'
        );
        assert.equal(
            hospedagem.update.mock.calls[0].arguments[0].observacaoImportada,
            'Reserva\nNova nota importada'
        );
    });

    it('4. aplica suíte + valor + observação quando os três divergem', async () => {
        const { hospedagem, linha } = setupCommonMocks(
            { total_amount: 52000, note: 'Combo alterado' },
            {
                valorTotal: 450,
                valorPago: 0,
                saldoPendente: 450,
                observacaoImportada: 'Reserva\nAntiga',
                observacaoOperador: null,
                observacoes: 'Reserva\nAntiga',
            },
            { idEventoSuite: 16, valorTotal: 450, preco: 450, valorFinal: 450 }
        );

        const result =
            await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
                reservationId: RESERVATION_ID,
                internalEntityId: ID_RESERVA,
            });

        assert.equal(result.applied, true);
        assert.equal(
            result.changes.some((c) => c.field === 'idEventoSuite'),
            true
        );
        assert.equal(
            result.changes.some((c) => c.field === 'valorTotal'),
            true
        );
        assert.equal(
            result.changes.some((c) => c.field === 'observacaoImportada'),
            true
        );
        assert.equal(hospedagem.update.mock.callCount(), 1);
        assert.ok(linha.update.mock.callCount() >= 1);
    });

    it('5. retorna ALREADY_ALIGNED quando suíte, valor e observação já coincidem', async () => {
        setupCommonMocks();

        const result =
            await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
                reservationId: RESERVATION_ID,
                internalEntityId: ID_RESERVA,
            });

        assert.equal(result.applied, false);
        assert.equal(result.skipped, 'ALREADY_ALIGNED');
        assert.equal(result.suiteSkipped, 'ALREADY_ALIGNED');
        assert.equal(result.changes.length, 0);
    });

    it('6. segunda execução é idempotente (ALREADY_ALIGNED)', async () => {
        const { hospedagem } = setupCommonMocks(
            { total_amount: 120000 },
            { valorTotal: 1000, valorPago: 300, saldoPendente: 700 }
        );

        const first =
            await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
                reservationId: RESERVATION_ID,
                internalEntityId: ID_RESERVA,
            });
        assert.equal(first.applied, true);

        hospedagem.valorTotal = 1200;
        hospedagem.saldoPendente = 900;
        hospedagem.ReservaSuite[0].valorTotal = 1200;
        hospedagem.ReservaSuite[0].preco = 1200;
        hospedagem.ReservaSuite[0].valorFinal = 1200;

        const second =
            await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
                reservationId: RESERVATION_ID,
                internalEntityId: ID_RESERVA,
            });
        assert.equal(second.applied, false);
        assert.equal(second.skipped, 'ALREADY_ALIGNED');
    });

    it('7. conflito de suíte não impede atualização de valor', async () => {
        const { hospedagem } = setupCommonMocks(
            { total_amount: 120000 },
            { valorTotal: 1000, valorPago: 300, saldoPendente: 700 },
            { idEventoSuite: 16 },
            { suiteConflito: true }
        );

        const result =
            await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
                reservationId: RESERVATION_ID,
                internalEntityId: ID_RESERVA,
            });

        assert.equal(result.applied, true);
        assert.equal(result.suiteSkipped, 'CONFLICT');
        assert.equal(
            result.changes.some((c) => c.field === 'idEventoSuite'),
            false
        );
        assert.equal(
            result.changes.some((c) => c.field === 'valorTotal'),
            true
        );
        assert.equal(hospedagem.update.mock.callCount(), 1);
    });

    it('8. conflito de suíte não impede atualização de observação', async () => {
        const { hospedagem } = setupCommonMocks(
            { note: 'Obs conflito suite' },
            {
                observacaoImportada: 'Reserva\nAntiga',
                observacaoOperador: 'Operador',
                observacoes: 'Reserva\nAntiga\n\nOperador',
            },
            { idEventoSuite: 16 },
            { suiteConflito: true }
        );

        const result =
            await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
                reservationId: RESERVATION_ID,
                internalEntityId: ID_RESERVA,
            });

        assert.equal(result.applied, true);
        assert.equal(result.suiteSkipped, 'CONFLICT');
        assert.equal(
            result.changes.some((c) => c.field === 'observacaoImportada'),
            true
        );
        assert.equal(hospedagem.update.mock.callCount(), 1);
    });

    it('9. recalcula saldoPendente corretamente (valorPago local preservado)', async () => {
        const { hospedagem } = setupCommonMocks(
            { total_amount: 120000 },
            { valorTotal: 1000, valorPago: 300, saldoPendente: 700 }
        );

        await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
            reservationId: RESERVATION_ID,
            internalEntityId: ID_RESERVA,
        });

        assert.deepEqual(hospedagem.update.mock.calls[0].arguments[0], {
            valorTotal: 1200,
            saldoPendente: 900,
        });
        assert.equal(
            (hospedagem.update.mock.calls[0].arguments[0] as any).valorPago,
            undefined
        );
    });

    it('10. não altera valorPago da reserva', async () => {
        const { hospedagem } = setupCommonMocks(
            { total_amount: 120000 },
            { valorTotal: 1000, valorPago: 300, saldoPendente: 700 }
        );

        await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
            reservationId: RESERVATION_ID,
            internalEntityId: ID_RESERVA,
        });

        const patch = hospedagem.update.mock.calls[0].arguments[0] as Record<
            string,
            unknown
        >;
        assert.equal('valorPago' in patch, false);
    });

    it('11. preserva observacaoOperador ao atualizar observação importada', async () => {
        const { hospedagem } = setupCommonMocks(
            { note: 'Nota nova' },
            {
                observacaoImportada: 'Reserva\nNota antiga',
                observacaoOperador: 'Trecho operador intacto',
                observacoes: 'Reserva\nNota antiga\n\nTrecho operador intacto',
            }
        );

        await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
            reservationId: RESERVATION_ID,
            internalEntityId: ID_RESERVA,
        });

        const patch = hospedagem.update.mock.calls[0].arguments[0] as Record<
            string,
            unknown
        >;
        assert.equal(patch.observacaoOperador, 'Trecho operador intacto');
        assert.equal(
            patch.observacoes,
            'Reserva\nNota nova\n\nTrecho operador intacto'
        );
    });

    it('12. não toca PagamentoHospedagem', async () => {
        setupCommonMocks({ total_amount: 120000, note: 'X' });
        const pagamentoUpdate = mock.fn(async () => undefined);
        mock.method(PagamentoHospedagem, 'findAll', async () => [
            { id: 1, update: pagamentoUpdate },
        ]);
        mock.method(PagamentoHospedagem, 'update', pagamentoUpdate);

        await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
            reservationId: RESERVATION_ID,
            internalEntityId: ID_RESERVA,
        });

        assert.equal(pagamentoUpdate.mock.callCount(), 0);
    });

    it('compat: syncSuiteIfChanged delega para syncLinkedExistingAllowedChanges', async () => {
        const { linha } = setupCommonMocks({}, {}, { idEventoSuite: 16 });

        const result = await linkedExistingSuiteSyncService.syncSuiteIfChanged({
            reservationId: RESERVATION_ID,
            internalEntityId: ID_RESERVA,
        });

        assert.equal(result.applied, true);
        assert.equal(linha.update.mock.callCount(), 1);
    });

    describe('observação importada — substituir, não concatenar', () => {
        it('substitui observação antiga pela nova do Hospedin', async () => {
            const { hospedagem } = setupCommonMocks(
                { note: 'Cliente pediu quarto silencioso' },
                {
                    observacaoImportada: 'Reserva\nCliente pediu cama extra',
                    observacaoOperador: null,
                    observacoes: 'Reserva\nCliente pediu cama extra',
                }
            );

            const result =
                await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges(
                    {
                        reservationId: RESERVATION_ID,
                        internalEntityId: ID_RESERVA,
                    }
                );

            assert.equal(result.applied, true);
            const patch = hospedagem.update.mock.calls[0].arguments[0] as Record<
                string,
                unknown
            >;
            assert.equal(
                patch.observacaoImportada,
                'Reserva\nCliente pediu quarto silencioso'
            );
            assert.equal(
                String(patch.observacaoImportada).includes('cama extra'),
                false
            );
            assert.equal(
                patch.observacoes,
                'Reserva\nCliente pediu quarto silencioso'
            );
        });

        it('não faz UPDATE quando Hospedin reenvia a mesma observação', async () => {
            setupCommonMocks(
                { note: 'Cliente pediu quarto silencioso' },
                {
                    observacaoImportada: 'Reserva\nCliente pediu quarto silencioso',
                    observacaoOperador: null,
                    observacoes: 'Reserva\nCliente pediu quarto silencioso',
                }
            );

            const result =
                await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges(
                    {
                        reservationId: RESERVATION_ID,
                        internalEntityId: ID_RESERVA,
                    }
                );

            assert.equal(result.applied, false);
            assert.equal(result.skipped, 'ALREADY_ALIGNED');
        });

        it('preserva observacaoOperador ao substituir importada', async () => {
            const { hospedagem } = setupCommonMocks(
                { note: 'Cliente pediu quarto silencioso' },
                {
                    observacaoImportada: 'Reserva\nCliente pediu cama extra',
                    observacaoOperador: 'Ligar antes do check-in.',
                    observacoes:
                        'Reserva\nCliente pediu cama extra\n\nLigar antes do check-in.',
                }
            );

            await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
                reservationId: RESERVATION_ID,
                internalEntityId: ID_RESERVA,
            });

            const patch = hospedagem.update.mock.calls[0].arguments[0] as Record<
                string,
                unknown
            >;
            assert.equal(patch.observacaoOperador, 'Ligar antes do check-in.');
            assert.equal(
                patch.observacaoImportada,
                'Reserva\nCliente pediu quarto silencioso'
            );
            assert.equal(
                patch.observacoes,
                'Reserva\nCliente pediu quarto silencioso\n\nLigar antes do check-in.'
            );
        });

        it('mantém importada e operador separados no campo derivado', async () => {
            const { hospedagem } = setupCommonMocks(
                { note: 'Nova nota Hospedin' },
                {
                    observacaoImportada: 'Reserva\nAntiga',
                    observacaoOperador: 'Observação local do operador',
                    observacoes:
                        'Reserva\nAntiga\n\nObservação local do operador',
                }
            );

            await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges({
                reservationId: RESERVATION_ID,
                internalEntityId: ID_RESERVA,
            });

            const patch = hospedagem.update.mock.calls[0].arguments[0] as Record<
                string,
                unknown
            >;
            assert.equal(patch.observacaoImportada, 'Reserva\nNova nota Hospedin');
            assert.equal(
                patch.observacaoOperador,
                'Observação local do operador'
            );
            assert.equal(
                patch.observacoes,
                'Reserva\nNova nota Hospedin\n\nObservação local do operador'
            );
        });

        it('sincronização repetida não duplica texto', async () => {
            const { hospedagem } = setupCommonMocks(
                { note: 'Cliente pediu quarto silencioso' },
                {
                    observacaoImportada: 'Reserva\nCliente pediu cama extra',
                    observacaoOperador: 'Ligar antes do check-in.',
                    observacoes:
                        'Reserva\nCliente pediu cama extra\n\nLigar antes do check-in.',
                }
            );

            const first =
                await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges(
                    {
                        reservationId: RESERVATION_ID,
                        internalEntityId: ID_RESERVA,
                    }
                );
            assert.equal(first.applied, true);

            hospedagem.observacaoImportada =
                'Reserva\nCliente pediu quarto silencioso';
            hospedagem.observacoes =
                'Reserva\nCliente pediu quarto silencioso\n\nLigar antes do check-in.';

            const second =
                await linkedExistingSuiteSyncService.syncLinkedExistingAllowedChanges(
                    {
                        reservationId: RESERVATION_ID,
                        internalEntityId: ID_RESERVA,
                    }
                );

            assert.equal(second.applied, false);
            assert.equal(second.skipped, 'ALREADY_ALIGNED');
            assert.equal(hospedagem.update.mock.callCount(), 1);
        });
    });
});
