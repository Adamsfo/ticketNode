/**
 * Testes — alterarPeriodoReservaAdmin × push Hospedin (origem HOSPEDIN).
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/services/hospedagemAdminAlterarPeriodoHospedin.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import { Transaction } from 'sequelize';
import { ReservaHospedagem, StatusReservaHospedagem } from '../models/ReservaHospedagem';
import { ReservaPeriodoMovimentacao } from '../models/ReservaPeriodoMovimentacao';
import { ReservaSuite } from '../models/ReservaSuite';
import { Usuario } from '../models/Usuario';
import connection from '../database';

const mockTx = {
    LOCK: { UPDATE: 'UPDATE' },
} as unknown as Transaction;

describe('alterarPeriodoReservaAdmin — push Hospedin', () => {
    afterEach(() => {
        const paths = [
            './hospedagemAdminService',
            './hospedagemRefreshVersionService',
            '../integrations/hospedin/outbound/HospedinOutboundEnqueueService',
            '../integrations/hospedin/services/hospedinAdminPeriodoTrocaPushService',
        ];
        for (const p of paths) {
            try {
                delete require.cache[require.resolve(p)];
            } catch {
                // ignore
            }
        }
    });

    it('estrutural — push Hospedin fica após a transaction e antes do markDirty', () => {
        const source = readFileSync(
            require.resolve('./hospedagemAdminService'),
            'utf8'
        );
        const idxFn = source.indexOf('export async function alterarPeriodoReservaAdmin');
        assert.ok(idxFn >= 0);

        const idxMov = source.indexOf('ReservaPeriodoMovimentacao.create', idxFn);
        assert.ok(idxMov > idxFn);
        const idxTransactionStart = source.lastIndexOf(
            'await connection.transaction(async (t: Transaction) => {',
            idxMov
        );
        assert.ok(idxTransactionStart > idxFn && idxTransactionStart < idxMov);

        const idxTransactionEnd = source.indexOf('});', idxMov);
        assert.ok(idxTransactionEnd > idxMov);

        const idxPush = source.indexOf(
            'pushAdminPeriodoTrocaToHospedin',
            idxTransactionEnd
        );
        assert.ok(idxPush > idxTransactionEnd);
        const idxMarkDirty = source.indexOf(
            'hospedinOutboundEnqueueService.markDirty',
            idxPush
        );
        assert.ok(idxMarkDirty > idxPush);

        const transactionBlock = source.slice(
            idxTransactionStart,
            idxTransactionEnd
        );
        assert.equal(
            /pushAdminPeriodoTrocaToHospedin/.test(transactionBlock),
            false
        );
        assert.equal(/markDirty/.test(transactionBlock), false);
    });

    async function executarAlteracaoComMocks(options: {
        origemReserva: string;
        onPush?: () => void;
    }) {
        let pushCalled = false;
        let markDirtyCalled = false;

        const checkinAnterior = new Date('2026-09-19T20:00:00.000Z');
        const checkoutAnterior = new Date('2026-09-20T17:00:00.000Z');
        const checkinNovo = new Date('2026-10-10T20:00:00.000Z');
        const checkoutNovo = new Date('2026-10-11T17:00:00.000Z');

        const reserva = {
            id: options.origemReserva === 'HOSPEDIN' ? 46 : 80,
            idEvento: 5,
            status: StatusReservaHospedagem.Confirmada,
            origemReserva: options.origemReserva,
            idExterno: options.origemReserva === 'HOSPEDIN' ? '29682746' : null,
            checkin: checkinAnterior,
            checkout: checkoutAnterior,
            update: async (data: Record<string, unknown>) => {
                Object.assign(reserva, data);
            },
            Evento: { id: 5, idProdutor: 1 },
            ReservaSuite: [
                {
                    id: options.origemReserva === 'HOSPEDIN' ? 46 : 80,
                    idEventoSuite: 13,
                    adultos: 2,
                    criancas: 0,
                    EventoSuite: {
                        id: 13,
                        nome: 'Suíte OURO',
                        status: 'Ativo',
                        qtdeMinimaPessoas: 1,
                        qtdeMaximaPessoas: 4,
                    },
                },
            ],
        };

        const originalFindByPkReserva = ReservaHospedagem.findByPk;
        const originalFindByPkUsuario = Usuario.findByPk;
        const originalPeriodoCreate = ReservaPeriodoMovimentacao.create;
        const originalSuiteFindAll = ReservaSuite.findAll;
        const originalTransaction = connection.transaction;

        ReservaHospedagem.findByPk = (async () => reserva) as typeof ReservaHospedagem.findByPk;
        Usuario.findByPk = (async () => ({ id: 4, admGeral: true })) as typeof Usuario.findByPk;
        ReservaPeriodoMovimentacao.create = (async () => ({ id: 1 })) as typeof ReservaPeriodoMovimentacao.create;
        ReservaSuite.findAll = (async () => []) as typeof ReservaSuite.findAll;
        connection.transaction = (async (fn: (t: Transaction) => Promise<void>) => {
            await fn(mockTx);
        }) as typeof connection.transaction;

        const servicePath = require.resolve('./hospedagemAdminService');
        const refreshPath = require.resolve('./hospedagemRefreshVersionService');
        const outboundPath = require.resolve(
            '../integrations/hospedin/outbound/HospedinOutboundEnqueueService'
        );
        const pushPath = require.resolve(
            '../integrations/hospedin/services/hospedinAdminPeriodoTrocaPushService'
        );
        const disponibilidadePath = require.resolve('./suiteDisponibilidadeService');
        const reservaSuitePath = require.resolve('./reservaSuiteService');

        require.cache[refreshPath] = {
            id: refreshPath,
            filename: refreshPath,
            loaded: true,
            exports: { incrementarHospedagemRefreshVersion: async () => undefined },
        };
        require.cache[outboundPath] = {
            id: outboundPath,
            filename: outboundPath,
            loaded: true,
            exports: {
                hospedinOutboundEnqueueService: {
                    markDirty: async () => {
                        markDirtyCalled = true;
                    },
                },
            },
        };
        require.cache[pushPath] = {
            id: pushPath,
            filename: pushPath,
            loaded: true,
            exports: {
                pushAdminPeriodoTrocaToHospedin: async () => {
                    pushCalled = true;
                    options.onPush?.();
                    return { patched: true, hospedinReservationIds: ['29682746'] };
                },
            },
        };
        require.cache[disponibilidadePath] = {
            id: disponibilidadePath,
            filename: disponibilidadePath,
            loaded: true,
            exports: {
                calcularDisponibilidadePeriodo: () => ({
                    conflitoPeriodo: false,
                    disponibilidadeNoDiaCheckin: { podeReservar: true },
                }),
            },
        };
        require.cache[reservaSuitePath] = {
            id: reservaSuitePath,
            filename: reservaSuitePath,
            loaded: true,
            exports: {
                carregarOcupantesSuiteParaPeriodo: async () => [],
                validarCapacidadeMaximaPousada: () => undefined,
            },
        };

        delete require.cache[servicePath];

        try {
            const hospedagemModule = require('./hospedagemAdminService');

            try {
                await hospedagemModule.alterarPeriodoReservaAdmin({
                    idReservaHospedagem: reserva.id,
                    idUsuario: 4,
                    checkin: checkinNovo,
                    checkout: checkoutNovo,
                    motivo: 'Alteração solicitada pelo cliente',
                });
            } catch {
                // obterReservaAdminDetalhe pode falhar com mocks incompletos;
                // o push Hospedin ocorre antes do retorno final.
            }

            return { pushCalled, markDirtyCalled, reserva, checkinNovo, checkoutNovo };
        } finally {
            ReservaHospedagem.findByPk = originalFindByPkReserva;
            Usuario.findByPk = originalFindByPkUsuario;
            ReservaPeriodoMovimentacao.create = originalPeriodoCreate;
            ReservaSuite.findAll = originalSuiteFindAll;
            connection.transaction = originalTransaction;
            delete require.cache[servicePath];
            delete require.cache[refreshPath];
            delete require.cache[outboundPath];
            delete require.cache[pushPath];
            delete require.cache[disponibilidadePath];
            delete require.cache[reservaSuitePath];
        }
    }

    it('origem HOSPEDIN — chama pushAdminPeriodoTrocaToHospedin após persistir', async () => {
        const { pushCalled, markDirtyCalled, reserva, checkinNovo, checkoutNovo } =
            await executarAlteracaoComMocks({ origemReserva: 'HOSPEDIN' });

        assert.equal(pushCalled, true);
        assert.equal(markDirtyCalled, true);
        assert.equal(reserva.checkin.toISOString(), checkinNovo.toISOString());
        assert.equal(reserva.checkout.toISOString(), checkoutNovo.toISOString());
    });

    it('origem ATENDENTE — não chama pushAdminPeriodoTrocaToHospedin', async () => {
        const { pushCalled } = await executarAlteracaoComMocks({
            origemReserva: 'ATENDENTE',
        });

        assert.equal(pushCalled, false);
    });
});
