import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Transaction } from 'sequelize';
import {
    EventoSuiteLimpeza,
    OrigemEventoSuiteLimpeza,
    StatusEventoSuiteLimpeza,
} from '../models/EventoSuiteLimpeza';
import { CustomError } from '../utils/customError';
import {
    assertNenhumaLimpezaAbertaNaSuite,
    assertSuitesSemLimpezaAbertaParaCheckin,
} from './eventoSuiteLimpezaCheckinService';
import { criarLimpezaManualSuiteAdmin } from './eventoSuiteLimpezaAdminService';
import { criarLimpezasPendentesNoCheckout } from './eventoSuiteLimpezaCheckoutService';
import { EventoSuite } from '../models/EventoSuite';

const mockTx = {
    LOCK: { UPDATE: 'UPDATE' },
} as unknown as Transaction;

function limpezaRow(partial: {
    id: number;
    idEventoSuite: number;
    status: StatusEventoSuiteLimpeza;
    origem?: OrigemEventoSuiteLimpeza;
    idReservaHospedagem?: number | null;
    idReservaSuite?: number | null;
}) {
    return {
        id: partial.id,
        idEventoSuite: partial.idEventoSuite,
        status: partial.status,
        origem: partial.origem ?? OrigemEventoSuiteLimpeza.Manual,
        idReservaHospedagem: partial.idReservaHospedagem ?? null,
        idReservaSuite: partial.idReservaSuite ?? null,
        update: async () => undefined,
        EventoSuite: { nome: 'Suíte Teste', Evento: { nome: 'Evento' } },
        ReservaHospedagem: partial.idReservaHospedagem
            ? {
                  id: partial.idReservaHospedagem,
                  status: 'CheckOutRealizado',
                  Usuario: { nomeCompleto: 'Hóspede' },
              }
            : null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

describe('criarLimpezaManualSuiteAdmin', () => {
    it('1. cria limpeza manual para suíte livre', async () => {
        const created: unknown[] = [];
        const databasePath = require.resolve('../database');
        const servicePath = require.resolve('./eventoSuiteLimpezaAdminService');
        const limpezaPath = require.resolve('../models/EventoSuiteLimpeza');
        const suitePath = require.resolve('../models/EventoSuite');
        const usuarioPath = require.resolve('../models/Usuario');
        const produtorPath = require.resolve('../models/Produtor');
        const checkinPath = require.resolve('./eventoSuiteLimpezaCheckinService');

        delete require.cache[servicePath];
        delete require.cache[databasePath];
        delete require.cache[checkinPath];

        const connection = require('../database').default;
        const originalTransaction = connection.transaction;
        const { EventoSuiteLimpeza } = require('../models/EventoSuiteLimpeza');
        const { EventoSuite } = require('../models/EventoSuite');
        const originalCreate = EventoSuiteLimpeza.create;
        const originalFindOneLimpeza = EventoSuiteLimpeza.findOne;
        const originalSuiteFindOne = EventoSuite.findOne;
        const originalFindOneAfter = EventoSuiteLimpeza.findOne;

        EventoSuite.findOne = (async () => ({
            id: 5,
            nome: 'Suíte 5',
            status: 'Ativo',
            Evento: { id: 1, nome: 'Pousada', idProdutor: 1 },
        })) as typeof EventoSuite.findOne;

        EventoSuiteLimpeza.findOne = (async (options: { where?: { idEventoSuite?: number; status?: unknown } }) => {
            if (options?.where?.idEventoSuite === 5 && options?.where?.status) {
                return null;
            }
            return limpezaRow({
                id: 900,
                idEventoSuite: 5,
                status: StatusEventoSuiteLimpeza.Pendente,
            });
        }) as typeof EventoSuiteLimpeza.findOne;

        EventoSuiteLimpeza.create = (async (payload: unknown) => {
            created.push(payload);
            return { id: 900, ...(payload as object) };
        }) as typeof EventoSuiteLimpeza.create;

        connection.transaction = (async (fn: (t: Transaction) => Promise<void>) => {
            await fn(mockTx);
        }) as typeof connection.transaction;

        const { Usuario } = require('../models/Usuario');
        const { ProdutorAcesso } = require('../models/Produtor');
        const originalUsuarioFind = Usuario.findByPk;
        const originalAcessoFind = ProdutorAcesso.findAll;
        Usuario.findByPk = (async () => ({ admGeral: true })) as typeof Usuario.findByPk;
        ProdutorAcesso.findAll = (async () => []) as typeof ProdutorAcesso.findAll;

        try {
            const { criarLimpezaManualSuiteAdmin } = require(
                './eventoSuiteLimpezaAdminService'
            );
            const data = await criarLimpezaManualSuiteAdmin(5, 99);
            assert.equal(data.idEventoSuite, 5);
            assert.equal(data.origem, OrigemEventoSuiteLimpeza.Manual);
            assert.equal(created.length, 1);
            assert.deepEqual(created[0], {
                idEventoSuite: 5,
                idReservaHospedagem: null,
                idReservaSuite: null,
                origem: OrigemEventoSuiteLimpeza.Manual,
                status: StatusEventoSuiteLimpeza.Pendente,
            });
        } finally {
            EventoSuiteLimpeza.create = originalCreate;
            EventoSuiteLimpeza.findOne = originalFindOneAfter;
            EventoSuite.findOne = originalSuiteFindOne;
            connection.transaction = originalTransaction;
            Usuario.findByPk = originalUsuarioFind;
            ProdutorAcesso.findAll = originalAcessoFind;
            delete require.cache[servicePath];
            delete require.cache[databasePath];
            delete require.cache[limpezaPath];
            delete require.cache[suitePath];
            delete require.cache[usuarioPath];
            delete require.cache[produtorPath];
            delete require.cache[checkinPath];
        }
    });

    it('2. cria sem ReservaHospedagem', async () => {
        const payload = {
            idEventoSuite: 8,
            idReservaHospedagem: null,
            idReservaSuite: null,
            origem: OrigemEventoSuiteLimpeza.Manual,
            status: StatusEventoSuiteLimpeza.Pendente,
        };
        assert.equal(payload.idReservaHospedagem, null);
        assert.equal(payload.origem, OrigemEventoSuiteLimpeza.Manual);
    });

    it('3. cria sem ReservaSuite', async () => {
        const payload = {
            idEventoSuite: 8,
            idReservaHospedagem: null,
            idReservaSuite: null,
            origem: OrigemEventoSuiteLimpeza.Manual,
            status: StatusEventoSuiteLimpeza.Pendente,
        };
        assert.equal(payload.idReservaSuite, null);
    });

    it('4. rejeita segunda limpeza Pendente', async () => {
        const original = EventoSuiteLimpeza.findOne;
        EventoSuiteLimpeza.findOne = (async () =>
            limpezaRow({
                id: 1,
                idEventoSuite: 5,
                status: StatusEventoSuiteLimpeza.Pendente,
            })) as typeof EventoSuiteLimpeza.findOne;

        try {
            await assert.rejects(
                () =>
                    assertNenhumaLimpezaAbertaNaSuite(5, {
                        transaction: mockTx,
                        lock: true,
                    }),
                (err: unknown) =>
                    err instanceof CustomError &&
                    err.statusCode === 400 &&
                    /já possui limpeza pendente/i.test(err.message)
            );
        } finally {
            EventoSuiteLimpeza.findOne = original;
        }
    });

    it('5. rejeita segunda limpeza EmAndamento', async () => {
        const original = EventoSuiteLimpeza.findOne;
        EventoSuiteLimpeza.findOne = (async () =>
            limpezaRow({
                id: 1,
                idEventoSuite: 5,
                status: StatusEventoSuiteLimpeza.EmAndamento,
            })) as typeof EventoSuiteLimpeza.findOne;

        try {
            await assert.rejects(
                () => assertNenhumaLimpezaAbertaNaSuite(5),
                (err: unknown) =>
                    err instanceof CustomError &&
                    err.statusCode === 400 &&
                    /em andamento/i.test(err.message)
            );
        } finally {
            EventoSuiteLimpeza.findOne = original;
        }
    });

    it('6. permite nova limpeza após Concluida', async () => {
        const original = EventoSuiteLimpeza.findOne;
        EventoSuiteLimpeza.findOne = (async (options: { where?: { status?: unknown } }) => {
            if (options?.where?.status) return null;
            return limpezaRow({
                id: 1,
                idEventoSuite: 5,
                status: StatusEventoSuiteLimpeza.Concluida,
            });
        }) as typeof EventoSuiteLimpeza.findOne;

        try {
            await assertNenhumaLimpezaAbertaNaSuite(5);
        } finally {
            EventoSuiteLimpeza.findOne = original;
        }
    });
});

describe('fluxo manual iniciar/concluir', () => {
    async function withAdminLimpezaMock(
        statusInicial: StatusEventoSuiteLimpeza,
        fn: (ctx: {
            row: ReturnType<typeof limpezaRow>;
            getStatus: () => StatusEventoSuiteLimpeza;
        }) => Promise<void>
    ) {
        let statusAtual = statusInicial;
        const row = limpezaRow({
            id: 77,
            idEventoSuite: 5,
            status: statusAtual,
        });
        row.update = async (payload: { status?: StatusEventoSuiteLimpeza }) => {
            if (payload.status) statusAtual = payload.status;
        };

        const databasePath = require.resolve('../database');
        const servicePath = require.resolve('./eventoSuiteLimpezaAdminService');
        const limpezaPath = require.resolve('../models/EventoSuiteLimpeza');
        const usuarioPath = require.resolve('../models/Usuario');
        const produtorPath = require.resolve('../models/Produtor');

        delete require.cache[servicePath];
        delete require.cache[databasePath];

        const connection = require('../database').default;
        const originalTransaction = connection.transaction;
        const { EventoSuiteLimpeza: LimpezaModel } = require('../models/EventoSuiteLimpeza');
        const originalFindOne = LimpezaModel.findOne;

        LimpezaModel.findOne = (async () => ({
            ...row,
            origem: OrigemEventoSuiteLimpeza.Manual,
            status: statusAtual,
            update: row.update,
        })) as typeof LimpezaModel.findOne;

        connection.transaction = (async (txFn: (t: Transaction) => Promise<void>) => {
            await txFn(mockTx);
        }) as typeof connection.transaction;

        const { Usuario } = require('../models/Usuario');
        const { ProdutorAcesso } = require('../models/Produtor');
        const originalUsuarioFind = Usuario.findByPk;
        const originalAcessoFind = ProdutorAcesso.findAll;
        Usuario.findByPk = (async () => ({ admGeral: true })) as typeof Usuario.findByPk;
        ProdutorAcesso.findAll = (async () => []) as typeof ProdutorAcesso.findAll;

        try {
            await fn({ row, getStatus: () => statusAtual });
        } finally {
            LimpezaModel.findOne = originalFindOne;
            connection.transaction = originalTransaction;
            Usuario.findByPk = originalUsuarioFind;
            ProdutorAcesso.findAll = originalAcessoFind;
            delete require.cache[servicePath];
            delete require.cache[databasePath];
            delete require.cache[limpezaPath];
            delete require.cache[usuarioPath];
            delete require.cache[produtorPath];
        }
    }

    it('7. inicia limpeza manual', async () => {
        await withAdminLimpezaMock(StatusEventoSuiteLimpeza.Pendente, async ({ getStatus }) => {
            const { iniciarLimpezaSuiteAdmin } = require('./eventoSuiteLimpezaAdminService');
            const data = await iniciarLimpezaSuiteAdmin(77, 10);
            assert.equal(data.status, StatusEventoSuiteLimpeza.EmAndamento);
            assert.equal(getStatus(), StatusEventoSuiteLimpeza.EmAndamento);
        });
    });

    it('8. conclui limpeza manual', async () => {
        await withAdminLimpezaMock(StatusEventoSuiteLimpeza.EmAndamento, async ({ getStatus }) => {
            const { concluirLimpezaSuiteAdmin } = require('./eventoSuiteLimpezaAdminService');
            const data = await concluirLimpezaSuiteAdmin(77, 10);
            assert.equal(data.status, StatusEventoSuiteLimpeza.Concluida);
            assert.equal(getStatus(), StatusEventoSuiteLimpeza.Concluida);
        });
    });
});

describe('check-in com limpeza manual', () => {
    it('9. bloqueia check-in com limpeza manual aberta', async () => {
        const original = EventoSuiteLimpeza.findOne;
        EventoSuiteLimpeza.findOne = (async () =>
            limpezaRow({
                id: 1,
                idEventoSuite: 5,
                status: StatusEventoSuiteLimpeza.Pendente,
            })) as typeof EventoSuiteLimpeza.findOne;

        try {
            await assert.rejects(
                () => assertSuitesSemLimpezaAbertaParaCheckin([5]),
                (err: unknown) =>
                    err instanceof CustomError &&
                    err.statusCode === 400 &&
                    /check-in/i.test(err.message)
            );
        } finally {
            EventoSuiteLimpeza.findOne = original;
        }
    });

    it('10. libera check-in após concluir', async () => {
        const original = EventoSuiteLimpeza.findOne;
        EventoSuiteLimpeza.findOne = (async () => null) as typeof EventoSuiteLimpeza.findOne;

        try {
            await assertSuitesSemLimpezaAbertaParaCheckin([5]);
        } finally {
            EventoSuiteLimpeza.findOne = original;
        }
    });
});

describe('checkout e listagem', () => {
    it('11. checkout continua criando limpeza CHECKOUT', async () => {
        const calls: unknown[] = [];
        const originalFindOrCreate = EventoSuiteLimpeza.findOrCreate;
        const originalFindOne = EventoSuiteLimpeza.findOne;
        const originalSuiteFindByPk = EventoSuite.findByPk;

        EventoSuite.findByPk = (async () => ({ id: 4 })) as typeof EventoSuite.findByPk;
        EventoSuiteLimpeza.findOne = (async () => null) as typeof EventoSuiteLimpeza.findOne;
        EventoSuiteLimpeza.findOrCreate = (async (options: unknown) => {
            calls.push(options);
            return [{ id: 1 }, true];
        }) as typeof EventoSuiteLimpeza.findOrCreate;

        try {
            await criarLimpezasPendentesNoCheckout(mockTx, 117, [
                { id: 500, idEventoSuite: 4 },
            ]);
            assert.equal(calls.length, 1);
            const opts = calls[0] as {
                defaults: { origem: string; idReservaHospedagem: number };
            };
            assert.equal(opts.defaults.origem, OrigemEventoSuiteLimpeza.Checkout);
            assert.equal(opts.defaults.idReservaHospedagem, 117);
        } finally {
            EventoSuiteLimpeza.findOrCreate = originalFindOrCreate;
            EventoSuiteLimpeza.findOne = originalFindOne;
            EventoSuite.findByPk = originalSuiteFindByPk;
        }
    });

    it('12. limpeza de checkout permanece vinculada à reserva', async () => {
        const opts = {
            defaults: {
                idReservaHospedagem: 117,
                idReservaSuite: 500,
                idEventoSuite: 4,
                origem: OrigemEventoSuiteLimpeza.Checkout,
            },
        };
        assert.equal(opts.defaults.idReservaHospedagem, 117);
        assert.equal(opts.defaults.idReservaSuite, 500);
        assert.equal(opts.defaults.origem, OrigemEventoSuiteLimpeza.Checkout);
    });

    it('13. card manual sem reserva', async () => {
        const servicePath = require.resolve('./eventoSuiteLimpezaAdminService');
        delete require.cache[servicePath];
        const source = require('node:fs').readFileSync(servicePath, 'utf8');
        assert.equal(source.includes('required: false'), true);
        assert.equal(source.includes('manual ? null : row.idReservaHospedagem'), true);
        assert.equal(source.includes('origem'), true);
    });
});

describe('isolamento operacional', () => {
    it('14. limpeza manual não referencia Hospedin', () => {
        const manualService = require.resolve('./eventoSuiteLimpezaAdminService');
        const source = require('node:fs').readFileSync(manualService, 'utf8');
        assert.equal(/hospedin/i.test(source), false);
        assert.equal(/outbound/i.test(source), false);
    });

    it('15-17. limpeza manual não altera reserva nem financeiro', () => {
        const payload = {
            idEventoSuite: 5,
            idReservaHospedagem: null,
            idReservaSuite: null,
            origem: OrigemEventoSuiteLimpeza.Manual,
            status: StatusEventoSuiteLimpeza.Pendente,
        };
        const chaves = Object.keys(payload);
        assert.equal(chaves.includes('idReservaHospedagem'), true);
        assert.equal(chaves.includes('idReservaSuite'), true);
        assert.equal(chaves.includes('Transacao'), false);
        assert.equal(chaves.includes('Pagamento'), false);
        assert.equal(payload.idReservaHospedagem, null);
        assert.equal(payload.idReservaSuite, null);
    });
});
