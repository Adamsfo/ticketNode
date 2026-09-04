import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { Transaction } from 'sequelize';
import { CustomError } from '../utils/customError';

const CPF_LUCAS = '025.804.471-30';
const CPF_DIGITS = '02580447130';

type TitularMock = {
    id: number;
    id_cliente: number | null;
    cpf: string | null;
    nomeCompleto: string;
    sobreNome: string | null;
    telefone: string | null;
    email: string | null;
    update: (payload: Record<string, unknown>) => Promise<void>;
};

function criarReservaBase(idUsuario: number) {
    const hoje = new Date();
    return {
        id: 100,
        idUsuario,
        status: 'Confirmada',
        checkin: hoje,
        checkout: new Date(hoje.getTime() + 86_400_000),
        valorTotal: 500,
        valorPago: 500,
        saldoPendente: 0,
        Pagamentos: [{ valor: 500 }],
        Evento: { id: 1, idProdutor: 1 },
        ReservaSuite: [],
        dataHoraChegadaReal: null,
        idVendaJango: null,
        preco: 400,
        taxaServico: 100,
        noites: 1,
        origemReserva: 'JANGO',
        update: async function updateReserva(this: Record<string, unknown>, payload: Record<string, unknown>) {
            Object.assign(this, payload);
        },
    };
}

describe('registrarChegadaAdmin — autoresolução id_cliente Jango', () => {
    let getClienteCalls: string[] = [];
    let atualizarClienteCalls: Record<string, unknown>[] = [];
    let getClienteHandler: (cpf: string) => Promise<unknown>;
    let titularUpdates: Record<string, unknown>[] = [];
    let transactionCalled = false;
    let outroUsuarioUpdated = false;

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
        const mockApiJango = () => ({
            getCliente: async (cpf: string) => {
                getClienteCalls.push(cpf);
                return getClienteHandler(cpf);
            },
            atualizarCliente: async (payload: Record<string, unknown>) => {
                atualizarClienteCalls.push(payload);
            },
            getConta: async () => [{ id_venda: 777 }],
            abreConta: async () => 777,
        });

        require.cache[apiJangoPath] = {
            id: apiJangoPath,
            filename: apiJangoPath,
            loaded: true,
            exports: {
                __esModule: true,
                default: mockApiJango,
            },
        };
    }

    function setupMocks(options: {
        titular: TitularMock;
        reserva?: ReturnType<typeof criarReservaBase>;
    }) {
        getClienteCalls = [];
        atualizarClienteCalls = [];
        titularUpdates = [];
        transactionCalled = false;
        outroUsuarioUpdated = false;

        const reserva = options.reserva ?? criarReservaBase(options.titular.id);

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
        originals.ReservaFindOne = ReservaHospedagem.findOne;
        originals.HistoricoFindAll = HistoricoTransacao.findAll;
        originals.connectionTransaction = connection.transaction;

        Usuario.findByPk = (async (id: number) => {
            if (id === 99) {
                return { id: 99, admGeral: true };
            }
            if (id === options.titular.id) {
                return options.titular;
            }
            if (id === 88) {
                outroUsuarioUpdated = true;
                return {
                    id: 88,
                    update: async () => {
                        outroUsuarioUpdated = true;
                    },
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
                    ...reserva,
                    update: reserva.update,
                };
            }
            return reserva;
        }) as typeof ReservaHospedagem.findByPk;

        ReservaHospedagem.findOne = (async () => null) as typeof ReservaHospedagem.findOne;
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
            ReservaHospedagem.findByPk = originals.ReservaFindByPk as typeof ReservaHospedagem.findByPk;
        }
        if (originals.ReservaFindOne) {
            ReservaHospedagem.findOne = originals.ReservaFindOne as typeof ReservaHospedagem.findOne;
        }
        if (originals.HistoricoFindAll) {
            HistoricoTransacao.findAll = originals.HistoricoFindAll as typeof HistoricoTransacao.findAll;
        }
        if (originals.connectionTransaction) {
            connection.transaction = originals.connectionTransaction;
        }
    }

    function criarTitular(overrides: Partial<TitularMock> = {}): TitularMock {
        const state = {
            id: 50,
            id_cliente: null as number | null,
            cpf: CPF_LUCAS,
            nomeCompleto: 'Lucas',
            sobreNome: 'Alexandre Guimarães',
            telefone: '(65) 99999-9999',
            email: 'lucas@example.com',
            ...overrides,
        };

        return {
            ...state,
            update: async (payload: Record<string, unknown>) => {
                titularUpdates.push(payload);
                if (payload.id_cliente != null) {
                    state.id_cliente = Number(payload.id_cliente);
                }
            },
        };
    }

    beforeEach(() => {
        resetModules();
    });

    afterEach(() => {
        restoreMocks();
        resetModules();
    });

    it('id_cliente já existe → não consulta Jango e mantém fluxo', async () => {
        const titular = criarTitular({ id_cliente: 42 });
        getClienteHandler = async () => {
            throw new Error('getCliente não deveria ser chamado');
        };
        setupMocks({ titular });

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaAdmin(100, 99),
            (err: unknown) => err instanceof CustomError && err.statusCode === 404
        );

        assert.equal(getClienteCalls.length, 0);
        assert.equal(atualizarClienteCalls.length, 0);
        assert.equal(titularUpdates.length, 0);
        assert.equal(transactionCalled, true);
    });

    it('sem id_cliente + CPF encontrado no Jango → vincula e continua', async () => {
        const titular = criarTitular({ id_cliente: null });
        getClienteHandler = async () => [{ id_cliente: 16, nome: 'Lucas' }];
        setupMocks({ titular });

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaAdmin(100, 99),
            (err: unknown) => err instanceof CustomError && err.statusCode === 404
        );

        assert.deepEqual(getClienteCalls, [CPF_DIGITS]);
        assert.equal(atualizarClienteCalls.length, 0);
        assert.deepEqual(titularUpdates, [{ id_cliente: 16 }]);
        assert.equal(transactionCalled, true);
        assert.equal(outroUsuarioUpdated, false);
    });

    it('sem id_cliente + CPF não encontrado → cadastra, consulta novamente e vincula', async () => {
        const titular = criarTitular({ id_cliente: null });
        let getClienteCount = 0;
        getClienteHandler = async () => {
            getClienteCount += 1;
            if (getClienteCount === 1) {
                return undefined;
            }
            return [{ id_cliente: 88 }];
        };
        setupMocks({ titular });

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            async () => {
                const promise = registrarChegadaAdmin(100, 99);
                await promise;
            },
            (err: unknown) => err instanceof CustomError && err.statusCode === 404
        );

        assert.equal(getClienteCalls.length, 2);
        assert.equal(atualizarClienteCalls.length, 1);
        assert.equal(atualizarClienteCalls[0]?.CPF_CNPJ, CPF_DIGITS);
        assert.equal(
            atualizarClienteCalls[0]?.NOME,
            'Lucas Alexandre Guimarães'
        );
        assert.deepEqual(titularUpdates, [{ id_cliente: 88 }]);
        assert.equal(transactionCalled, true);
    });

    it('sem CPF válido → mantém bloqueio atual', async () => {
        const titular = criarTitular({ id_cliente: null, cpf: null });
        getClienteHandler = async () => {
            throw new Error('getCliente não deveria ser chamado');
        };
        setupMocks({ titular });

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaAdmin(100, 99),
            (err: unknown) =>
                err instanceof CustomError &&
                err.statusCode === 400 &&
                /id_cliente/i.test(err.message)
        );

        assert.equal(getClienteCalls.length, 0);
        assert.equal(transactionCalled, false);
        assert.equal(titularUpdates.length, 0);
    });

    it('falha no Jango → não registra chegada', async () => {
        const titular = criarTitular({ id_cliente: null });
        getClienteHandler = async () => ({ error: 'CPF e/ou senha errados!' });
        setupMocks({ titular });

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaAdmin(100, 99),
            (err: unknown) =>
                err instanceof CustomError &&
                err.statusCode === 400 &&
                /CPF e\/ou senha errados/i.test(err.message)
        );

        assert.equal(getClienteCalls.length, 2);
        assert.equal(atualizarClienteCalls.length, 1);
        assert.equal(titularUpdates.length, 0);
        assert.equal(transactionCalled, false);
    });

    it('vincula somente o Usuario responsável da reserva', async () => {
        const titular = criarTitular({ id: 50, id_cliente: null });
        const reserva = criarReservaBase(50);
        getClienteHandler = async () => [{ id_cliente: 31 }];
        setupMocks({ titular, reserva });

        const { registrarChegadaAdmin } = require('./hospedagemAdminService');

        await assert.rejects(
            () => registrarChegadaAdmin(100, 99),
            (err: unknown) => err instanceof CustomError && err.statusCode === 404
        );

        assert.deepEqual(titularUpdates, [{ id_cliente: 31 }]);
        assert.equal(outroUsuarioUpdated, false);
        assert.equal(reserva.idUsuario, 50);
    });
});
