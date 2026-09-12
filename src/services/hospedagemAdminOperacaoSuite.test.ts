import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { Transaction } from 'sequelize';
import { CustomError } from '../utils/customError';
import { StatusReservaSuite } from '../models/ReservaSuite';
import { StatusReservaHospedagem } from '../models/ReservaHospedagem';

type InseriIngressoCall = [number, string, number, number];

function criarReservaMultiSuite(overrides: Record<string, unknown> = {}) {
    const hoje = new Date();
    const suite1 = {
        id: 500,
        idReservaHospedagem: 200,
        idEventoSuite: 1,
        adultos: 2,
        criancas: 0,
        status: StatusReservaSuite.Confirmada,
        dataHoraChegadaReal: null,
        dataHoraCheckinReal: null,
        dataHoraCheckoutRealizado: null,
        idUsuarioCheckout: null,
        update: async function updateSuite(
            this: Record<string, unknown>,
            payload: Record<string, unknown>
        ) {
            Object.assign(this, payload);
        },
    };
    const suite2 = {
        id: 501,
        idReservaHospedagem: 200,
        idEventoSuite: 3,
        adultos: 3,
        criancas: 0,
        status: StatusReservaSuite.Confirmada,
        dataHoraChegadaReal: null,
        dataHoraCheckinReal: null,
        dataHoraCheckoutRealizado: null,
        idUsuarioCheckout: null,
        update: async function updateSuite(
            this: Record<string, unknown>,
            payload: Record<string, unknown>
        ) {
            Object.assign(this, payload);
        },
    };

    return {
        id: 200,
        idUsuario: 50,
        status: StatusReservaHospedagem.Confirmada,
        checkin: hoje,
        checkout: new Date(hoje.getTime() + 86_400_000),
        valorTotal: 1000,
        valorPago: 1000,
        saldoPendente: 0,
        Pagamentos: [{ valor: 1000 }],
        Evento: { id: 1, idProdutor: 1 },
        ReservaSuite: [suite1, suite2],
        dataHoraChegadaReal: null,
        dataHoraCheckinReal: null,
        idVendaJango: null,
        idTransacao: 10,
        preco: 900,
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

describe('operacao por ReservaSuite — chegada e check-in', () => {
    let inseriIngressoCalls: InseriIngressoCall[] = [];
    let contagemPdv = { adultos: 0, criancas: 0 };
    let reservaState: ReturnType<typeof criarReservaMultiSuite>;
    let historicoCreates: unknown[] = [];
    let limpezaAssertIds: number[] = [];

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
                        if (descricao.includes('Adulto')) contagemPdv.adultos += 1;
                        if (descricao.includes('Crian')) contagemPdv.criancas += 1;
                        return null;
                    },
                    contarIngressosHospedagemPorVenda: async () => contagemPdv,
                }),
            },
        };
    }

    function setupMocks(reservaOverrides: Record<string, unknown> = {}) {
        inseriIngressoCalls = [];
        contagemPdv = { adultos: 0, criancas: 0 };
        historicoCreates = [];
        limpezaAssertIds = [];
        reservaState = criarReservaMultiSuite(reservaOverrides);

        const { Usuario } = require('../models/Usuario');
        const { ReservaHospedagem } = require('../models/ReservaHospedagem');
        const { ReservaSuite } = require('../models/ReservaSuite');
        const { HistoricoTransacao } = require('../models/Transacao');
        const connection = require('../database').default;

        aplicarMockApiJango();
        resetModules();

        originals.UsuarioFindByPk = Usuario.findByPk;
        originals.ReservaFindByPk = ReservaHospedagem.findByPk;
        originals.ReservaFindOne = ReservaHospedagem.findOne;
        originals.ReservaSuiteFindByPk = ReservaSuite.findByPk;
        originals.ReservaSuiteFindAll = ReservaSuite.findAll;
        originals.HistoricoCreate = HistoricoTransacao.create;
        originals.connectionTransaction = connection.transaction;

        Usuario.findByPk = async (id: number) => {
            if (id === 99) {
                return { id: 99, admGeral: true };
            }
            return {
                id: 50,
                id_cliente: 42,
                cpf: '52998224725',
                nomeCompleto: 'Hospede',
                sobreNome: 'Teste',
                telefone: '65999999999',
                email: 'h@teste.com',
                update: async () => undefined,
            };
        };

        ReservaHospedagem.findByPk = async (
            _id: number,
            opts?: { lock?: unknown; transaction?: Transaction }
        ) => {
            if (opts?.lock) {
                return {
                    ...reservaState,
                    update: async (payload: Record<string, unknown>) => {
                        Object.assign(reservaState, payload);
                    },
                };
            }
            return reservaState;
        };

        ReservaHospedagem.findOne = async () => reservaState;

        ReservaSuite.findByPk = async (
            id: number,
            opts?: { lock?: unknown; transaction?: Transaction }
        ) => {
            const suite = reservaState.ReservaSuite.find((s) => s.id === id);
            if (!suite) return null;
            if (opts?.lock) {
                return {
                    ...suite,
                    update: async (payload: Record<string, unknown>) => {
                        Object.assign(suite, payload);
                    },
                };
            }
            return suite;
        };

        ReservaSuite.findAll = async () => reservaState.ReservaSuite;

        HistoricoTransacao.create = async (payload: unknown) => {
            historicoCreates.push(payload);
            return payload;
        };

        connection.transaction = async (fn: (t: Transaction) => Promise<void>) => {
            const t = { LOCK: { UPDATE: 'UPDATE' } } as Transaction;
            await fn(t);
        };

        const limpezaPath = require.resolve('./eventoSuiteLimpezaCheckinService');
        require.cache[limpezaPath] = {
            id: limpezaPath,
            filename: limpezaPath,
            loaded: true,
            exports: {
                assertSuitesSemLimpezaAbertaParaCheckin: async (ids: number[]) => {
                    limpezaAssertIds.push(...ids);
                },
            },
        };

        const escopoPath = require.resolve('./hospedagemAdminService');
        // resolverEscopoProdutor is internal — mock ProdutorAcesso via module if needed
        const { ProdutorAcesso } = require('../models/Produtor');
        originals.ProdutorFindAll = ProdutorAcesso.findAll;
        ProdutorAcesso.findAll = async () => [{ idProdutor: 1 }];
    }

    afterEach(() => {
        const { Usuario } = require('../models/Usuario');
        const { ReservaHospedagem } = require('../models/ReservaHospedagem');
        const { ReservaSuite } = require('../models/ReservaSuite');
        const { HistoricoTransacao } = require('../models/Transacao');
        const connection = require('../database').default;
        const { ProdutorAcesso } = require('../models/Produtor');

        if (originals.UsuarioFindByPk) {
            Usuario.findByPk = originals.UsuarioFindByPk;
        }
        if (originals.ReservaFindByPk) {
            ReservaHospedagem.findByPk = originals.ReservaFindByPk;
        }
        if (originals.ReservaFindOne) {
            ReservaHospedagem.findOne = originals.ReservaFindOne;
        }
        if (originals.ReservaSuiteFindByPk) {
            ReservaSuite.findByPk = originals.ReservaSuiteFindByPk;
        }
        if (originals.ReservaSuiteFindAll) {
            ReservaSuite.findAll = originals.ReservaSuiteFindAll;
        }
        if (originals.HistoricoCreate) {
            HistoricoTransacao.create = originals.HistoricoCreate;
        }
        if (originals.connectionTransaction) {
            connection.transaction = originals.connectionTransaction;
        }
        if (originals.ProdutorFindAll) {
            ProdutorAcesso.findAll = originals.ProdutorFindAll;
        }
        resetModules();
    });

    beforeEach(() => {
        setupMocks();
    });

    it('chegada da suíte 1 não altera a suíte 2', async () => {
        const {
            registrarChegadaReservaSuiteAdmin,
        } = require('./hospedagemAdminService');

        await registrarChegadaReservaSuiteAdmin(200, 500, 99);

        const s1 = reservaState.ReservaSuite[0];
        const s2 = reservaState.ReservaSuite[1];
        assert.ok(s1.dataHoraChegadaReal);
        assert.equal(s2.dataHoraChegadaReal, null);
        assert.equal(inseriIngressoCalls.length, 2);
    });

    it('chegada da suíte 2 depois da suíte 1', async () => {
        const {
            registrarChegadaReservaSuiteAdmin,
        } = require('./hospedagemAdminService');

        await registrarChegadaReservaSuiteAdmin(200, 500, 99);
        await registrarChegadaReservaSuiteAdmin(200, 501, 99);

        assert.ok(reservaState.ReservaSuite[0].dataHoraChegadaReal);
        assert.ok(reservaState.ReservaSuite[1].dataHoraChegadaReal);
        assert.equal(inseriIngressoCalls.length, 5);
    });

    it('check-in da suíte 1 mantém suíte 2 confirmada', async () => {
        const {
            registrarChegadaReservaSuiteAdmin,
            realizarCheckinReservaSuiteAdmin,
        } = require('./hospedagemAdminService');

        await registrarChegadaReservaSuiteAdmin(200, 500, 99);
        reservaState.idVendaJango = 777;

        await realizarCheckinReservaSuiteAdmin(200, 500, 99);

        assert.equal(reservaState.ReservaSuite[0].status, StatusReservaSuite.Hospedada);
        assert.equal(reservaState.ReservaSuite[1].status, StatusReservaSuite.Confirmada);
        assert.equal(reservaState.status, StatusReservaHospedagem.Confirmada);
        assert.equal(historicoCreates.length, 0);
        assert.deepEqual(limpezaAssertIds, [1]);
    });

    it('check-in da suíte 2 completa a reserva', async () => {
        const {
            registrarChegadaReservaSuiteAdmin,
            realizarCheckinReservaSuiteAdmin,
        } = require('./hospedagemAdminService');

        await registrarChegadaReservaSuiteAdmin(200, 500, 99);
        await registrarChegadaReservaSuiteAdmin(200, 501, 99);
        reservaState.idVendaJango = 777;

        await realizarCheckinReservaSuiteAdmin(200, 500, 99);
        await realizarCheckinReservaSuiteAdmin(200, 501, 99);

        assert.equal(reservaState.ReservaSuite[0].status, StatusReservaSuite.Hospedada);
        assert.equal(reservaState.ReservaSuite[1].status, StatusReservaSuite.Hospedada);
        assert.equal(reservaState.status, StatusReservaHospedagem.Hospedada);
        assert.ok(reservaState.dataHoraCheckinReal);
        assert.equal(historicoCreates.length, 1);
    });

    it('rejeita idReservaSuite de outra reserva', async () => {
        const { registrarChegadaReservaSuiteAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaReservaSuiteAdmin(200, 999, 99),
            (err: CustomError) => err.statusCode === 404
        );
    });

    it('rejeita suíte inexistente no check-in', async () => {
        const { realizarCheckinReservaSuiteAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => realizarCheckinReservaSuiteAdmin(200, 999, 99),
            (err: CustomError) => err.statusCode === 404
        );
    });

    it('repetir check-in na mesma suíte é rejeitado', async () => {
        const {
            registrarChegadaReservaSuiteAdmin,
            realizarCheckinReservaSuiteAdmin,
        } = require('./hospedagemAdminService');

        await registrarChegadaReservaSuiteAdmin(200, 500, 99);
        reservaState.idVendaJango = 777;
        await realizarCheckinReservaSuiteAdmin(200, 500, 99);

        await assert.rejects(
            () => realizarCheckinReservaSuiteAdmin(200, 500, 99),
            (err: CustomError) => err.statusCode === 400
        );
    });

    it('reserva mono-suíte continua funcionando no check-in', async () => {
        const hoje = new Date();
        const suiteUnica = {
            id: 600,
            idReservaHospedagem: 300,
            idEventoSuite: 10,
            adultos: 2,
            criancas: 1,
            status: StatusReservaSuite.Confirmada,
            dataHoraChegadaReal: null,
            dataHoraCheckinReal: null,
            update: async function updateSuite(
                this: Record<string, unknown>,
                payload: Record<string, unknown>
            ) {
                Object.assign(this, payload);
            },
        };
        setupMocks({
            id: 300,
            ReservaSuite: [suiteUnica],
        });

        const {
            registrarChegadaReservaSuiteAdmin,
            realizarCheckinReservaSuiteAdmin,
        } = require('./hospedagemAdminService');

        await registrarChegadaReservaSuiteAdmin(300, 600, 99);
        reservaState.idVendaJango = 777;
        await realizarCheckinReservaSuiteAdmin(300, 600, 99);

        assert.equal(reservaState.ReservaSuite[0].status, StatusReservaSuite.Hospedada);
        assert.equal(reservaState.status, StatusReservaHospedagem.Hospedada);
        assert.equal(inseriIngressoCalls.length, 3);
    });
});

describe('operacao por ReservaSuite — check-out', () => {
    let reservaState: ReturnType<typeof criarReservaMultiSuite>;
    let historicoCreates: unknown[] = [];
    let limpezaCheckoutCalls: Array<{ id: number; idEventoSuite: number }> = [];

    const originals: Record<string, unknown> = {};

    function resetModules() {
        try {
            delete require.cache[require.resolve('./hospedagemAdminService')];
        } catch {
            // serviço ainda não carregado
        }
    }

    function prepararReservaHospedada() {
        const agora = new Date();
        reservaState = criarReservaMultiSuite({
            status: StatusReservaHospedagem.Hospedada,
            dataHoraCheckinReal: agora,
        });
        reservaState.ReservaSuite[0].status = StatusReservaSuite.Hospedada;
        reservaState.ReservaSuite[0].dataHoraCheckinReal = agora;
        reservaState.ReservaSuite[1].status = StatusReservaSuite.Hospedada;
        reservaState.ReservaSuite[1].dataHoraCheckinReal = agora;
    }

    function setupMocksCheckout() {
        historicoCreates = [];
        limpezaCheckoutCalls = [];
        prepararReservaHospedada();

        const { Usuario } = require('../models/Usuario');
        const { ReservaHospedagem } = require('../models/ReservaHospedagem');
        const { ReservaSuite } = require('../models/ReservaSuite');
        const { HistoricoTransacao } = require('../models/Transacao');
        const connection = require('../database').default;
        const { ProdutorAcesso } = require('../models/Produtor');

        resetModules();

        originals.UsuarioFindByPk = Usuario.findByPk;
        originals.ReservaFindByPk = ReservaHospedagem.findByPk;
        originals.ReservaSuiteFindByPk = ReservaSuite.findByPk;
        originals.ReservaSuiteFindAll = ReservaSuite.findAll;
        originals.HistoricoCreate = HistoricoTransacao.create;
        originals.connectionTransaction = connection.transaction;
        originals.ProdutorFindAll = ProdutorAcesso.findAll;

        Usuario.findByPk = async (id: number) => {
            if (id === 99) {
                return { id: 99, admGeral: true };
            }
            return { id: 50 };
        };

        ReservaHospedagem.findByPk = async (
            _id: number,
            opts?: { lock?: unknown; transaction?: Transaction }
        ) => {
            if (opts?.lock) {
                return {
                    ...reservaState,
                    update: async (payload: Record<string, unknown>) => {
                        Object.assign(reservaState, payload);
                    },
                };
            }
            return reservaState;
        };

        ReservaSuite.findByPk = async (
            id: number,
            opts?: { lock?: unknown; transaction?: Transaction }
        ) => {
            const suite = reservaState.ReservaSuite.find((s) => s.id === id);
            if (!suite) return null;
            if (opts?.lock) {
                return {
                    ...suite,
                    update: async (payload: Record<string, unknown>) => {
                        Object.assign(suite, payload);
                    },
                };
            }
            return suite;
        };

        ReservaSuite.findAll = async () => reservaState.ReservaSuite;

        HistoricoTransacao.create = async (payload: unknown) => {
            historicoCreates.push(payload);
            return payload;
        };

        connection.transaction = async (fn: (t: Transaction) => Promise<void>) => {
            const t = { LOCK: { UPDATE: 'UPDATE' } } as Transaction;
            await fn(t);
        };

        ProdutorAcesso.findAll = async () => [{ idProdutor: 1 }];

        const limpezaCheckoutPath = require.resolve(
            './eventoSuiteLimpezaCheckoutService'
        );
        require.cache[limpezaCheckoutPath] = {
            id: limpezaCheckoutPath,
            filename: limpezaCheckoutPath,
            loaded: true,
            exports: {
                criarLimpezasPendentesNoCheckout: async (
                    _t: Transaction,
                    _idReserva: number,
                    suites: Array<{ id: number; idEventoSuite: number }>
                ) => {
                    limpezaCheckoutCalls.push(...suites);
                },
            },
        };
    }

    afterEach(() => {
        const { Usuario } = require('../models/Usuario');
        const { ReservaHospedagem } = require('../models/ReservaHospedagem');
        const { ReservaSuite } = require('../models/ReservaSuite');
        const { HistoricoTransacao } = require('../models/Transacao');
        const connection = require('../database').default;
        const { ProdutorAcesso } = require('../models/Produtor');

        if (originals.UsuarioFindByPk) {
            Usuario.findByPk = originals.UsuarioFindByPk;
        }
        if (originals.ReservaFindByPk) {
            ReservaHospedagem.findByPk = originals.ReservaFindByPk;
        }
        if (originals.ReservaSuiteFindByPk) {
            ReservaSuite.findByPk = originals.ReservaSuiteFindByPk;
        }
        if (originals.ReservaSuiteFindAll) {
            ReservaSuite.findAll = originals.ReservaSuiteFindAll;
        }
        if (originals.HistoricoCreate) {
            HistoricoTransacao.create = originals.HistoricoCreate;
        }
        if (originals.connectionTransaction) {
            connection.transaction = originals.connectionTransaction;
        }
        if (originals.ProdutorFindAll) {
            ProdutorAcesso.findAll = originals.ProdutorFindAll;
        }
        resetModules();
    });

    beforeEach(() => {
        setupMocksCheckout();
    });

    it('checkout da suíte A mantém suíte B hospedada', async () => {
        const { realizarCheckoutReservaSuiteAdmin } = require('./hospedagemAdminService');

        await realizarCheckoutReservaSuiteAdmin(200, 500, 99);

        assert.equal(
            reservaState.ReservaSuite[0].status,
            StatusReservaSuite.CheckOutRealizado
        );
        assert.ok(reservaState.ReservaSuite[0].dataHoraCheckoutRealizado);
        assert.equal(
            reservaState.ReservaSuite[1].status,
            StatusReservaSuite.Hospedada
        );
        assert.equal(reservaState.status, StatusReservaHospedagem.Hospedada);
        assert.ok(!reservaState.dataHoraCheckoutRealizado);
        assert.equal(historicoCreates.length, 0);
        assert.equal(limpezaCheckoutCalls.length, 1);
        assert.equal(limpezaCheckoutCalls[0].id, 500);
        assert.equal(limpezaCheckoutCalls[0].idEventoSuite, 1);
    });

    it('checkout da suíte B completa a reserva', async () => {
        const { realizarCheckoutReservaSuiteAdmin } = require('./hospedagemAdminService');

        await realizarCheckoutReservaSuiteAdmin(200, 500, 99);
        await realizarCheckoutReservaSuiteAdmin(200, 501, 99);

        assert.equal(
            reservaState.ReservaSuite[0].status,
            StatusReservaSuite.CheckOutRealizado
        );
        assert.equal(
            reservaState.ReservaSuite[1].status,
            StatusReservaSuite.CheckOutRealizado
        );
        assert.equal(reservaState.status, StatusReservaHospedagem.CheckOutRealizado);
        assert.ok(reservaState.dataHoraCheckoutRealizado);
        assert.equal(historicoCreates.length, 1);
        assert.equal(limpezaCheckoutCalls.length, 2);
        assert.equal(limpezaCheckoutCalls[1].id, 501);
        assert.equal(limpezaCheckoutCalls[1].idEventoSuite, 3);
    });

    it('reserva mono-suíte: checkout por suíte conclui a reserva', async () => {
        const agora = new Date();
        const suiteUnica = {
            id: 600,
            idReservaHospedagem: 300,
            idEventoSuite: 10,
            adultos: 2,
            criancas: 0,
            status: StatusReservaSuite.Hospedada,
            dataHoraChegadaReal: agora,
            dataHoraCheckinReal: agora,
            dataHoraCheckoutRealizado: null,
            idUsuarioCheckout: null,
            update: async function updateSuite(
                this: Record<string, unknown>,
                payload: Record<string, unknown>
            ) {
                Object.assign(this, payload);
            },
        };
        reservaState = criarReservaMultiSuite({
            id: 300,
            status: StatusReservaHospedagem.Hospedada,
            dataHoraCheckinReal: agora,
            ReservaSuite: [suiteUnica],
        });

        const { realizarCheckoutReservaSuiteAdmin } = require('./hospedagemAdminService');

        await realizarCheckoutReservaSuiteAdmin(300, 600, 99);

        assert.equal(
            reservaState.ReservaSuite[0].status,
            StatusReservaSuite.CheckOutRealizado
        );
        assert.equal(reservaState.status, StatusReservaHospedagem.CheckOutRealizado);
        assert.equal(historicoCreates.length, 1);
        assert.equal(limpezaCheckoutCalls.length, 1);
    });

    it('rejeita checkout de suíte que não pertence à reserva', async () => {
        const { realizarCheckoutReservaSuiteAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => realizarCheckoutReservaSuiteAdmin(200, 999, 99),
            (err: CustomError) => err.statusCode === 404
        );
    });

    it('rejeita checkout de suíte que não está hospedada', async () => {
        reservaState.ReservaSuite[0].status = StatusReservaSuite.Confirmada;
        const { realizarCheckoutReservaSuiteAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => realizarCheckoutReservaSuiteAdmin(200, 500, 99),
            (err: CustomError) => err.statusCode === 400
        );
    });
});
