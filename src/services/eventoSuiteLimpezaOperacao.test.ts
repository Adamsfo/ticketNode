import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Transaction } from 'sequelize';
import { StatusEventoSuiteLimpeza } from '../models/EventoSuiteLimpeza';
import { CustomError } from '../utils/customError';
import {
    validarConclusaoLimpeza,
    validarInicioLimpeza,
} from './eventoSuiteLimpezaAdminService';

describe('validarInicioLimpeza', () => {
    it('Pendente pode iniciar', () => {
        assert.doesNotThrow(() =>
            validarInicioLimpeza(StatusEventoSuiteLimpeza.Pendente)
        );
    });

    it('EmAndamento não pode iniciar', () => {
        assert.throws(
            () => validarInicioLimpeza(StatusEventoSuiteLimpeza.EmAndamento),
            (err: unknown) =>
                err instanceof CustomError && err.statusCode === 400
        );
    });

    it('Concluida não pode iniciar', () => {
        assert.throws(
            () => validarInicioLimpeza(StatusEventoSuiteLimpeza.Concluida),
            (err: unknown) =>
                err instanceof CustomError &&
                err.statusCode === 400 &&
                /concluída/i.test(err.message)
        );
    });
});

describe('validarConclusaoLimpeza', () => {
    it('EmAndamento pode concluir', () => {
        assert.doesNotThrow(() =>
            validarConclusaoLimpeza(StatusEventoSuiteLimpeza.EmAndamento)
        );
    });

    it('Pendente não pode concluir diretamente', () => {
        assert.throws(
            () => validarConclusaoLimpeza(StatusEventoSuiteLimpeza.Pendente),
            (err: unknown) =>
                err instanceof CustomError &&
                err.statusCode === 400 &&
                /iniciada/i.test(err.message)
        );
    });

    it('Concluida não pode concluir novamente', () => {
        assert.throws(
            () => validarConclusaoLimpeza(StatusEventoSuiteLimpeza.Concluida),
            (err: unknown) =>
                err instanceof CustomError && err.statusCode === 400
        );
    });
});

describe('payload operacional de limpeza', () => {
    it('início grava somente campos da limpeza', () => {
        const idUsuario = 42;
        const agora = new Date('2026-09-03T18:00:00.000Z');
        const payload = {
            status: StatusEventoSuiteLimpeza.EmAndamento,
            dataHoraInicio: agora,
            idUsuarioInicio: idUsuario,
        };

        assert.deepEqual(Object.keys(payload).sort(), [
            'dataHoraInicio',
            'idUsuarioInicio',
            'status',
        ]);
        assert.equal(payload.idUsuarioInicio, idUsuario);
    });

    it('conclusão grava somente campos da limpeza', () => {
        const idUsuario = 77;
        const agora = new Date('2026-09-03T19:00:00.000Z');
        const payload = {
            status: StatusEventoSuiteLimpeza.Concluida,
            dataHoraFim: agora,
            idUsuarioFim: idUsuario,
        };

        assert.deepEqual(Object.keys(payload).sort(), [
            'dataHoraFim',
            'idUsuarioFim',
            'status',
        ]);
        assert.equal(payload.idUsuarioFim, idUsuario);
    });

    it('não altera entidades de hospedagem/disponibilidade', () => {
        const entidadesProibidas = [
            'ReservaHospedagem',
            'ReservaSuite',
            'EventoSuite',
            'SuiteDisponibilidadeService',
        ];
        const payloadInicio = {
            status: StatusEventoSuiteLimpeza.EmAndamento,
            dataHoraInicio: new Date(),
            idUsuarioInicio: 1,
        };
        const payloadConclusao = {
            status: StatusEventoSuiteLimpeza.Concluida,
            dataHoraFim: new Date(),
            idUsuarioFim: 1,
        };

        for (const entidade of entidadesProibidas) {
            assert.equal(
                JSON.stringify(payloadInicio).includes(entidade),
                false
            );
            assert.equal(
                JSON.stringify(payloadConclusao).includes(entidade),
                false
            );
        }
    });
});

describe('concorrência — lock na transação', () => {
    it('iniciar usa LOCK.UPDATE ao carregar a limpeza', async () => {
        const mockTx = {
            LOCK: { UPDATE: 'UPDATE' },
        } as unknown as Transaction;

        let lockUsadoNaTransacao: unknown = null;

        const databasePath = require.resolve('../database');
        const servicePath = require.resolve('./eventoSuiteLimpezaAdminService');
        const limpezaPath = require.resolve('../models/EventoSuiteLimpeza');
        const usuarioPath = require.resolve('../models/Usuario');
        const produtorPath = require.resolve('../models/Produtor');

        delete require.cache[servicePath];
        delete require.cache[databasePath];

        const connection = require('../database').default;
        const originalTransaction = connection.transaction;
        const { EventoSuiteLimpeza, StatusEventoSuiteLimpeza } = require(
            '../models/EventoSuiteLimpeza'
        );
        const originalFindOne = EventoSuiteLimpeza.findOne;

        EventoSuiteLimpeza.findOne = (async (options: {
            lock?: unknown;
            transaction?: Transaction;
        }) => {
            if (options?.transaction) {
                lockUsadoNaTransacao = options?.lock ?? null;
            }
            return {
                id: 1,
                status: StatusEventoSuiteLimpeza.Pendente,
                update: async () => undefined,
                EventoSuite: { nome: 'Azaléia', Evento: { nome: 'Evento' } },
                ReservaHospedagem: {
                    id: 10,
                    status: 'CheckOutRealizado',
                    Usuario: { nomeCompleto: 'Hóspede' },
                },
            };
        }) as typeof EventoSuiteLimpeza.findOne;

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
            const { iniciarLimpezaSuiteAdmin } = require(
                './eventoSuiteLimpezaAdminService'
            );
            await iniciarLimpezaSuiteAdmin(1, 99);
            assert.equal(lockUsadoNaTransacao, 'UPDATE');
        } finally {
            EventoSuiteLimpeza.findOne = originalFindOne;
            connection.transaction = originalTransaction;
            Usuario.findByPk = originalUsuarioFind;
            ProdutorAcesso.findAll = originalAcessoFind;
            delete require.cache[servicePath];
            delete require.cache[databasePath];
            delete require.cache[limpezaPath];
            delete require.cache[usuarioPath];
            delete require.cache[produtorPath];
        }
    });
});
