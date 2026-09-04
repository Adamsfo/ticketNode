import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { Transaction } from 'sequelize';
import { CustomError } from '../utils/customError';

type InseriIngressoCall = [number, string, number, number];

type ContagemPdv = { adultos: number; criancas: number };

function criarReservaBase(overrides: Record<string, unknown> = {}) {
    const hoje = new Date();
    return {
        id: 100,
        idUsuario: 50,
        status: 'Confirmada',
        checkin: hoje,
        checkout: new Date(hoje.getTime() + 86_400_000),
        valorTotal: 500,
        valorPago: 500,
        saldoPendente: 0,
        Pagamentos: [{ valor: 500 }],
        Evento: { id: 1, idProdutor: 1 },
        ReservaSuite: [{ adultos: 2, criancas: 2 }],
        dataHoraChegadaReal: null,
        idVendaJango: null,
        preco: 400,
        taxaServico: 100,
        noites: 1,
        origemReserva: 'JANGO',
        update: async function updateReserva(
            this: Record<string, unknown>,
            payload: Record<string, unknown>
        ) {
            Object.assign(this, payload);
        },
        ...overrides,
    };
}

describe('registrarChegadaAdmin — ingressos PDV hospedagem', () => {
    let inseriIngressoCalls: InseriIngressoCall[] = [];
    let contagemCalls: number[] = [];
    let contagemHandler: (idVenda: number, callIndex: number) => ContagemPdv;
    let contagemCallIndex = 0;
    let transactionCalled = false;
    let lockedReservaUpdates: Record<string, unknown>[] = [];
    let reservaState: ReturnType<typeof criarReservaBase>;

    const originals: Record<string, unknown> = {};

    function resetModules() {
        try {
            delete require.cache[require.resolve('./hospedagemAdminService')];
        } catch {
            // serviço ainda não carregado
        }
    }

    function aplicarMockApiJango() {
        const apiJangoPath = require.resolve('../api/apiJango');
        require.cache[apiJangoPath] = {
            id: apiJangoPath,
            filename: apiJangoPath,
            loaded: true,
            exports: {
                __esModule: true,
                default: () => ({
                    getCliente: async () => [{ id_cliente: 42 }],
                    getConta: async () => [{ id_venda: 777 }],
                    abreConta: async () => 777,
                    inseriIngresso: async (
                        idIngresso: number,
                        descricao: string,
                        idCliente: number,
                        idVenda: number
                    ) => {
                        inseriIngressoCalls.push([
                            idIngresso,
                            descricao,
                            idCliente,
                            idVenda,
                        ]);
                        return null;
                    },
                    contarIngressosHospedagemPorVenda: async (idVenda: number) => {
                        contagemCalls.push(Number(idVenda));
                        contagemCallIndex += 1;
                        return contagemHandler(Number(idVenda), contagemCallIndex);
                    },
                }),
            },
        };
    }

    function setupMocks(reservaOverrides: Record<string, unknown> = {}) {
        inseriIngressoCalls = [];
        contagemCalls = [];
        contagemCallIndex = 0;
        transactionCalled = false;
        lockedReservaUpdates = [];
        reservaState = criarReservaBase(reservaOverrides);

        contagemHandler = () => ({ adultos: 0, criancas: 0 });

        const { Usuario } = require('../models/Usuario');
        const { ReservaHospedagem } = require('../models/ReservaHospedagem');
        const { HistoricoTransacao } = require('../models/Transacao');
        const connection = require('../database').default;

        aplicarMockApiJango();

        try {
            delete require.cache[require.resolve('./hospedagemAdminService')];
        } catch {
            // serviço ainda não carregado
        }

        originals.UsuarioFindByPk = Usuario.findByPk;
        originals.ReservaFindByPk = ReservaHospedagem.findByPk;
        originals.HistoricoFindAll = HistoricoTransacao.findAll;
        originals.connectionTransaction = connection.transaction;

        Usuario.findByPk = (async (id: number) => {
            if (id === 99) {
                return { id: 99, admGeral: true };
            }
            if (id === 50) {
                return {
                    id: 50,
                    id_cliente: 42,
                    cpf: '025.804.471-30',
                    nomeCompleto: 'Titular',
                    sobreNome: 'Teste',
                    telefone: '(65) 99999-9999',
                    email: 'titular@example.com',
                    update: async () => undefined,
                };
            }
            return null;
        }) as typeof Usuario.findByPk;

        ReservaHospedagem.findByPk = (async (
            _id: number,
            opts?: { lock?: unknown; transaction?: Transaction }
        ) => {
            if (opts?.lock) {
                return {
                    ...reservaState,
                    update: async (payload: Record<string, unknown>) => {
                        lockedReservaUpdates.push(payload);
                        await reservaState.update(payload);
                    },
                };
            }
            return reservaState;
        }) as typeof ReservaHospedagem.findByPk;

        HistoricoTransacao.findAll = (async () => []) as typeof HistoricoTransacao.findAll;

        connection.transaction = (async (fn: (t: Transaction) => Promise<void>) => {
            transactionCalled = true;
            const mockTx = { LOCK: { UPDATE: 'UPDATE' } } as unknown as Transaction;
            await fn(mockTx);
        }) as typeof connection.transaction;
    }

    function restoreMocks() {
        const { Usuario } = require('../models/Usuario');
        const { ReservaHospedagem } = require('../models/ReservaHospedagem');
        const { HistoricoTransacao } = require('../models/Transacao');
        const connection = require('../database').default;

        if (originals.UsuarioFindByPk) {
            Usuario.findByPk = originals.UsuarioFindByPk as typeof Usuario.findByPk;
        }
        if (originals.ReservaFindByPk) {
            ReservaHospedagem.findByPk =
                originals.ReservaFindByPk as typeof ReservaHospedagem.findByPk;
        }
        if (originals.HistoricoFindAll) {
            HistoricoTransacao.findAll =
                originals.HistoricoFindAll as typeof HistoricoTransacao.findAll;
        }
        if (originals.connectionTransaction) {
            connection.transaction = originals.connectionTransaction;
        }
    }

    beforeEach(() => {
        resetModules();
    });

    afterEach(() => {
        restoreMocks();
        resetModules();
    });

    it('2 adultos + 2 crianças → 4 inseriIngresso(1, …)', async () => {
        setupMocks();
        contagemHandler = (_id, idx) =>
            idx === 1
                ? { adultos: 0, criancas: 0 }
                : { adultos: 2, criancas: 2 };

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaAdmin(100, 99),
            (err: unknown) => err instanceof CustomError && err.statusCode === 404
        );

        assert.equal(inseriIngressoCalls.length, 4);
        assert.deepEqual(
            inseriIngressoCalls.filter((c) => c[1] === 'Adulto').length,
            2
        );
        assert.deepEqual(
            inseriIngressoCalls.filter((c) => c[1] === 'Criança').length,
            2
        );
        for (const call of inseriIngressoCalls) {
            assert.equal(call[0], 1);
            assert.equal(call[2], 42);
            assert.equal(call[3], 777);
        }
        assert.equal(contagemCalls.length, 2);
        assert.equal(transactionCalled, true);
    });

    it('soma em várias ReservaSuite → totais corretos', async () => {
        setupMocks({
            ReservaSuite: [
                { adultos: 1, criancas: 1 },
                { adultos: 1, criancas: 1 },
            ],
        });
        contagemHandler = (_id, idx) =>
            idx === 1
                ? { adultos: 0, criancas: 0 }
                : { adultos: 2, criancas: 2 };

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaAdmin(100, 99),
            (err: unknown) => err instanceof CustomError && err.statusCode === 404
        );

        assert.equal(inseriIngressoCalls.length, 4);
    });

    it('contagem antes já completa → 0 inseriIngresso', async () => {
        setupMocks();
        contagemHandler = () => ({ adultos: 2, criancas: 2 });

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaAdmin(100, 99),
            (err: unknown) => err instanceof CustomError && err.statusCode === 404
        );

        assert.equal(inseriIngressoCalls.length, 0);
        assert.equal(contagemCalls.length, 1);
    });

    it('chegada já registrada + ingressos faltando → cria déficit sem alterar dataHoraChegadaReal', async () => {
        const chegada = new Date('2026-03-01T15:00:00.000Z');
        setupMocks({
            dataHoraChegadaReal: chegada,
            idVendaJango: 777,
        });
        contagemHandler = (_id, idx) => {
            if (idx === 1) return { adultos: 1, criancas: 1 };
            if (idx === 2) return { adultos: 1, criancas: 1 };
            return { adultos: 2, criancas: 2 };
        };

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaAdmin(100, 99),
            (err: unknown) => err instanceof CustomError && err.statusCode === 404
        );

        assert.equal(inseriIngressoCalls.length, 2);
        assert.equal(
            inseriIngressoCalls.filter((c) => c[1] === 'Adulto').length,
            1
        );
        assert.equal(
            inseriIngressoCalls.filter((c) => c[1] === 'Criança').length,
            1
        );
        for (const payload of lockedReservaUpdates) {
            assert.equal(payload.dataHoraChegadaReal, undefined);
        }
    });

    it('re-clique idempotente com chegada + venda + ingressos completos → 0 INSERT', async () => {
        const chegada = new Date('2026-03-01T15:00:00.000Z');
        setupMocks({
            dataHoraChegadaReal: chegada,
            idVendaJango: 777,
        });
        contagemHandler = () => ({ adultos: 2, criancas: 2 });

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaAdmin(100, 99),
            (err: unknown) => err instanceof CustomError && err.statusCode === 404
        );

        assert.equal(inseriIngressoCalls.length, 0);
        assert.equal(contagemCalls.length, 1);
        assert.equal(transactionCalled, false);
    });

    it('existentes > esperado → 0 INSERT e sem erro bloqueante', async () => {
        setupMocks();
        contagemHandler = () => ({ adultos: 3, criancas: 3 });

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaAdmin(100, 99),
            (err: unknown) => err instanceof CustomError && err.statusCode === 404
        );

        assert.equal(inseriIngressoCalls.length, 0);
        assert.equal(contagemCalls.length, 1);
    });

    it('pós-INSERT ainda incompleto → 502 e sem update da reserva', async () => {
        setupMocks();
        contagemHandler = () => ({ adultos: 0, criancas: 0 });

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaAdmin(100, 99),
            (err: unknown) =>
                err instanceof CustomError &&
                err.statusCode === 502 &&
                /ingressos no PDV Jango/i.test(err.message)
        );

        assert.equal(inseriIngressoCalls.length, 4);
        assert.equal(lockedReservaUpdates.length, 0);
    });

    it('adultos + crianças = 0 → 400 e 0 INSERT', async () => {
        setupMocks({ ReservaSuite: [{ adultos: 0, criancas: 0 }] });

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaAdmin(100, 99),
            (err: unknown) =>
                err instanceof CustomError &&
                err.statusCode === 400 &&
                /hóspedes/i.test(err.message)
        );

        assert.equal(inseriIngressoCalls.length, 0);
        assert.equal(transactionCalled, true);
    });

    it('verificação antes e depois dos INSERTs quando há déficit', async () => {
        setupMocks();
        contagemHandler = (_id, idx) =>
            idx === 1 ? { adultos: 0, criancas: 0 } : { adultos: 2, criancas: 2 };

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaAdmin(100, 99),
            (err: unknown) => err instanceof CustomError && err.statusCode === 404
        );

        assert.equal(contagemCalls.length, 2);
        assert.equal(inseriIngressoCalls.length, 4);
    });
});
