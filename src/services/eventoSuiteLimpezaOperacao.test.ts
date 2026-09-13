import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Transaction } from 'sequelize';
import { StatusEventoSuiteLimpeza } from '../models/EventoSuiteLimpeza';
import { CustomError } from '../utils/customError';
import {
    filtrarTarefasAtuaisPorFiltro,
    ordenarTarefasConcluidasPorDataHoraFim,
    paginarTarefasAtuais,
    selecionarTarefasAtuaisPorSuite,
    validarConclusaoLimpeza,
    validarInicioLimpeza,
} from './eventoSuiteLimpezaAdminService';

function limpeza(
    id: number,
    idEventoSuite: number,
    status: StatusEventoSuiteLimpeza,
    createdAt: string,
    dataHoraFim?: string | null
) {
    return {
        id,
        idEventoSuite,
        status,
        createdAt: new Date(createdAt),
        dataHoraFim:
            dataHoraFim === undefined
                ? undefined
                : dataHoraFim
                  ? new Date(dataHoraFim)
                  : null,
    };
}

describe('situação atual por suíte — filtros de listagem', () => {
    it('1. suíte com apenas uma tarefa Concluída aparece em Concluídas', () => {
        const rows = [limpeza(1, 101, StatusEventoSuiteLimpeza.Concluida, '2026-09-10')];
        const atuais = selecionarTarefasAtuaisPorSuite(rows);
        const filtradas = filtrarTarefasAtuaisPorFiltro(atuais, 'concluida');
        assert.equal(filtradas.length, 1);
        assert.equal(filtradas[0].id, 1);
    });

    it('2. Concluída antiga + Pendente mais nova: Pendentes sim, Concluídas não', () => {
        const rows = [
            limpeza(1, 101, StatusEventoSuiteLimpeza.Concluida, '2026-09-09'),
            limpeza(2, 101, StatusEventoSuiteLimpeza.Pendente, '2026-09-10'),
        ];
        const atuais = selecionarTarefasAtuaisPorSuite(rows);
        assert.equal(atuais.length, 1);
        assert.equal(atuais[0].id, 2);

        const pendentes = filtrarTarefasAtuaisPorFiltro(atuais, 'pendente');
        const concluidas = filtrarTarefasAtuaisPorFiltro(atuais, 'concluida');
        assert.equal(pendentes.length, 1);
        assert.equal(concluidas.length, 0);
    });

    it('3. Concluída antiga + EmAndamento mais nova não aparece em Concluídas', () => {
        const rows = [
            limpeza(1, 101, StatusEventoSuiteLimpeza.Concluida, '2026-09-09'),
            limpeza(2, 101, StatusEventoSuiteLimpeza.EmAndamento, '2026-09-10'),
        ];
        const atuais = selecionarTarefasAtuaisPorSuite(rows);
        const concluidas = filtrarTarefasAtuaisPorFiltro(atuais, 'concluida');
        const pendentes = filtrarTarefasAtuaisPorFiltro(atuais, 'pendente');
        assert.equal(concluidas.length, 0);
        assert.equal(pendentes.length, 1);
        assert.equal(pendentes[0].id, 2);
    });

    it('4. três tarefas: Concluídas mostra somente a mais nova Concluída', () => {
        const rows = [
            limpeza(1, 101, StatusEventoSuiteLimpeza.Concluida, '2026-09-09'),
            limpeza(2, 101, StatusEventoSuiteLimpeza.Pendente, '2026-09-10'),
            limpeza(3, 101, StatusEventoSuiteLimpeza.Concluida, '2026-09-11'),
        ];
        const atuais = selecionarTarefasAtuaisPorSuite(rows);
        const concluidas = filtrarTarefasAtuaisPorFiltro(atuais, 'concluida');
        assert.equal(atuais.length, 1);
        assert.equal(atuais[0].id, 3);
        assert.equal(concluidas.length, 1);
        assert.equal(concluidas[0].id, 3);
    });

    it('5. duas suítes diferentes: cada uma aparece uma única vez em Todas', () => {
        const rows = [
            limpeza(1, 101, StatusEventoSuiteLimpeza.Concluida, '2026-09-09'),
            limpeza(2, 101, StatusEventoSuiteLimpeza.Pendente, '2026-09-10'),
            limpeza(3, 202, StatusEventoSuiteLimpeza.Concluida, '2026-09-08'),
            limpeza(4, 202, StatusEventoSuiteLimpeza.EmAndamento, '2026-09-11'),
        ];
        const atuais = selecionarTarefasAtuaisPorSuite(rows);
        const todas = filtrarTarefasAtuaisPorFiltro(atuais, 'todas');
        assert.equal(atuais.length, 2);
        assert.equal(todas.length, 2);
        assert.deepEqual(
            todas.map((t) => t.id).sort(),
            [2, 4]
        );
    });

    it('6. paginação/total refletem tarefas atuais após filtro', () => {
        const rows = [
            limpeza(
                1,
                101,
                StatusEventoSuiteLimpeza.Concluida,
                '2026-09-09',
                '2026-09-09T10:00:00Z'
            ),
            limpeza(
                2,
                102,
                StatusEventoSuiteLimpeza.Concluida,
                '2026-09-10',
                '2026-09-13T12:20:00Z'
            ),
            limpeza(
                3,
                103,
                StatusEventoSuiteLimpeza.Concluida,
                '2026-09-11',
                '2026-09-13T11:45:00Z'
            ),
            limpeza(4, 104, StatusEventoSuiteLimpeza.Pendente, '2026-09-12'),
        ];
        const atuais = selecionarTarefasAtuaisPorSuite(rows);
        const concluidas = ordenarTarefasConcluidasPorDataHoraFim(
            filtrarTarefasAtuaisPorFiltro(atuais, 'concluida')
        );
        const pagina1 = paginarTarefasAtuais(concluidas, 1, 2);
        const pagina2 = paginarTarefasAtuais(concluidas, 2, 2);

        assert.equal(concluidas.length, 3);
        assert.equal(pagina1.total, 3);
        assert.equal(pagina1.data.length, 2);
        assert.deepEqual(pagina1.data.map((t) => t.id), [2, 3]);
        assert.equal(pagina1.totalPages, 2);
        assert.equal(pagina1.hasMore, true);
        assert.equal(pagina2.data.length, 1);
        assert.equal(pagina2.data[0].id, 1);
        assert.equal(pagina2.hasMore, false);
    });
});

describe('ordenação Concluídas — dataHoraFim DESC', () => {
    it('1. duas suítes concluídas: mais recentemente finalizada primeiro', () => {
        const rows = [
            limpeza(
                1,
                101,
                StatusEventoSuiteLimpeza.Concluida,
                '2026-09-10',
                '2026-09-13T10:30:00Z'
            ),
            limpeza(
                2,
                102,
                StatusEventoSuiteLimpeza.Concluida,
                '2026-09-09',
                '2026-09-13T12:20:00Z'
            ),
        ];
        const ordenadas = ordenarTarefasConcluidasPorDataHoraFim(
            filtrarTarefasAtuaisPorFiltro(
                selecionarTarefasAtuaisPorSuite(rows),
                'concluida'
            )
        );
        assert.deepEqual(ordenadas.map((t) => t.id), [2, 1]);
    });

    it('2. ordem usa dataHoraFim e não createdAt', () => {
        const rows = [
            limpeza(
                1,
                101,
                StatusEventoSuiteLimpeza.Concluida,
                '2026-09-13T18:00:00Z',
                '2026-09-13T10:30:00Z'
            ),
            limpeza(
                2,
                102,
                StatusEventoSuiteLimpeza.Concluida,
                '2026-09-12T08:00:00Z',
                '2026-09-13T12:20:00Z'
            ),
        ];
        const porCreatedAt = selecionarTarefasAtuaisPorSuite(rows).map((t) => t.id);
        const ordenadas = ordenarTarefasConcluidasPorDataHoraFim(
            filtrarTarefasAtuaisPorFiltro(
                selecionarTarefasAtuaisPorSuite(rows),
                'concluida'
            )
        );
        assert.deepEqual(porCreatedAt, [1, 2]);
        assert.deepEqual(ordenadas.map((t) => t.id), [2, 1]);
    });

    it('3. dataHoraFim NULL fica no final', () => {
        const rows = [
            limpeza(
                1,
                101,
                StatusEventoSuiteLimpeza.Concluida,
                '2026-09-10',
                null
            ),
            limpeza(
                2,
                102,
                StatusEventoSuiteLimpeza.Concluida,
                '2026-09-09',
                '2026-09-13T11:45:00Z'
            ),
        ];
        const ordenadas = ordenarTarefasConcluidasPorDataHoraFim(
            filtrarTarefasAtuaisPorFiltro(
                selecionarTarefasAtuaisPorSuite(rows),
                'concluida'
            )
        );
        assert.deepEqual(ordenadas.map((t) => t.id), [2, 1]);
    });

    it('4. Pendentes mantêm ordenação atual (createdAt da tarefa atual)', () => {
        const rows = [
            limpeza(1, 101, StatusEventoSuiteLimpeza.Pendente, '2026-09-09'),
            limpeza(2, 102, StatusEventoSuiteLimpeza.EmAndamento, '2026-09-11'),
            limpeza(3, 103, StatusEventoSuiteLimpeza.Pendente, '2026-09-10'),
        ];
        const atuais = selecionarTarefasAtuaisPorSuite(rows);
        const pendentes = filtrarTarefasAtuaisPorFiltro(atuais, 'pendente');
        assert.deepEqual(pendentes.map((t) => t.id), [2, 3, 1]);
    });

    it('5. Em andamento mantém ordenação atual (createdAt da tarefa atual)', () => {
        const rows = [
            limpeza(1, 101, StatusEventoSuiteLimpeza.EmAndamento, '2026-09-09'),
            limpeza(2, 102, StatusEventoSuiteLimpeza.EmAndamento, '2026-09-11'),
            limpeza(3, 103, StatusEventoSuiteLimpeza.EmAndamento, '2026-09-10'),
        ];
        const atuais = selecionarTarefasAtuaisPorSuite(rows);
        const emAndamento = filtrarTarefasAtuaisPorFiltro(atuais, 'em_andamento');
        assert.deepEqual(emAndamento.map((t) => t.id), [2, 3, 1]);
    });

    it('7. Concluída antiga + Pendente mais recente não aparece em Concluídas', () => {
        const rows = [
            limpeza(
                1,
                101,
                StatusEventoSuiteLimpeza.Concluida,
                '2026-09-09',
                '2026-09-09T18:00:00Z'
            ),
            limpeza(2, 101, StatusEventoSuiteLimpeza.Pendente, '2026-09-10'),
        ];
        const concluidas = ordenarTarefasConcluidasPorDataHoraFim(
            filtrarTarefasAtuaisPorFiltro(
                selecionarTarefasAtuaisPorSuite(rows),
                'concluida'
            )
        );
        assert.equal(concluidas.length, 0);
    });
});

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
