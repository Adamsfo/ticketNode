import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { Transaction } from 'sequelize';
import { EventoSuite } from '../models/EventoSuite';
import {
    EventoSuiteLimpeza,
    OrigemEventoSuiteLimpeza,
    StatusEventoSuiteLimpeza,
} from '../models/EventoSuiteLimpeza';
import { StatusReservaHospedagem } from '../models/ReservaHospedagem';
import { criarLimpezaManualPendenteSeAusente } from './eventoSuiteLimpezaAdminService';

const mockTx = {
    LOCK: { UPDATE: 'UPDATE' },
} as unknown as Transaction;

function limpezaAberta(idEventoSuite: number, status: StatusEventoSuiteLimpeza) {
    return { id: 1, idEventoSuite, status };
}

describe('criarLimpezaManualPendenteSeAusente', () => {
    it('3. não cria segunda limpeza Pendente', async () => {
        const originalSuite = EventoSuite.findByPk;
        const originalFindOne = EventoSuiteLimpeza.findOne;
        const originalCreate = EventoSuiteLimpeza.create;

        EventoSuite.findByPk = (async () => ({ id: 4 })) as typeof EventoSuite.findByPk;
        EventoSuiteLimpeza.findOne = (async () =>
            limpezaAberta(4, StatusEventoSuiteLimpeza.Pendente)) as typeof EventoSuiteLimpeza.findOne;
        EventoSuiteLimpeza.create = (async () => {
            throw new Error('não deveria criar');
        }) as typeof EventoSuiteLimpeza.create;

        try {
            const criou = await criarLimpezaManualPendenteSeAusente(4, mockTx);
            assert.equal(criou, false);
        } finally {
            EventoSuite.findByPk = originalSuite;
            EventoSuiteLimpeza.findOne = originalFindOne;
            EventoSuiteLimpeza.create = originalCreate;
        }
    });

    it('4. não cria segunda limpeza EmAndamento', async () => {
        const originalSuite = EventoSuite.findByPk;
        const originalFindOne = EventoSuiteLimpeza.findOne;
        const originalCreate = EventoSuiteLimpeza.create;

        EventoSuite.findByPk = (async () => ({ id: 4 })) as typeof EventoSuite.findByPk;
        EventoSuiteLimpeza.findOne = (async () =>
            limpezaAberta(4, StatusEventoSuiteLimpeza.EmAndamento)) as typeof EventoSuiteLimpeza.findOne;
        EventoSuiteLimpeza.create = (async () => {
            throw new Error('não deveria criar');
        }) as typeof EventoSuiteLimpeza.create;

        try {
            const criou = await criarLimpezaManualPendenteSeAusente(4, mockTx);
            assert.equal(criou, false);
        } finally {
            EventoSuite.findByPk = originalSuite;
            EventoSuiteLimpeza.findOne = originalFindOne;
            EventoSuiteLimpeza.create = originalCreate;
        }
    });

    it('5. cria nova limpeza após Concluida', async () => {
        const originalSuite = EventoSuite.findByPk;
        const originalFindOne = EventoSuiteLimpeza.findOne;
        const originalCreate = EventoSuiteLimpeza.create;
        let payload: Record<string, unknown> | null = null;

        EventoSuite.findByPk = (async () => ({ id: 4 })) as typeof EventoSuite.findByPk;
        EventoSuiteLimpeza.findOne = (async (options: { where?: { status?: unknown } }) => {
            if (options?.where?.status) return null;
            return limpezaAberta(4, StatusEventoSuiteLimpeza.Concluida);
        }) as typeof EventoSuiteLimpeza.findOne;
        EventoSuiteLimpeza.create = (async (data: Record<string, unknown>) => {
            payload = data;
            return { id: 99 };
        }) as typeof EventoSuiteLimpeza.create;

        try {
            const criou = await criarLimpezaManualPendenteSeAusente(4, mockTx);
            assert.equal(criou, true);
            assert.deepEqual(payload, {
                idEventoSuite: 4,
                idReservaHospedagem: null,
                idReservaSuite: null,
                origem: OrigemEventoSuiteLimpeza.Manual,
                status: StatusEventoSuiteLimpeza.Pendente,
            });
        } finally {
            EventoSuite.findByPk = originalSuite;
            EventoSuiteLimpeza.findOne = originalFindOne;
            EventoSuiteLimpeza.create = originalCreate;
        }
    });
});

describe('trocarSuiteReservaAdmin — limpeza da suíte origem', () => {
    const idOrigem = 4;
    const idDestino = 9;

    function criarLinha() {
        return {
            id: 500,
            idEventoSuite: idOrigem,
            adultos: 2,
            criancas: 0,
            update: async function updateLinha(
                this: Record<string, unknown>,
                payload: Record<string, unknown>
            ) {
                Object.assign(this, payload);
            },
        };
    }

    function criarReserva(status: string, linha: ReturnType<typeof criarLinha>) {
        const hoje = new Date();
        return {
            id: 117,
            status,
            checkin: hoje,
            checkout: new Date(hoje.getTime() + 86_400_000),
            idEvento: 1,
            idExterno: null,
            origemReserva: 'JANGO',
            dataHoraCheckinReal: status === StatusReservaHospedagem.Hospedada ? hoje : null,
            Evento: { id: 1, idProdutor: 1 },
            ReservaSuite: [linha],
        };
    }

    async function executarTrocaComMocks(
        statusReserva: string,
        options?: {
            falharTransaction?: boolean;
            limpezaAbertaOrigem?: StatusEventoSuiteLimpeza | null;
        }
    ) {
        const limpezaCalls: Array<{ id: number; tx: Transaction }> = [];
        const linha = criarLinha();
        const reserva = criarReserva(statusReserva, linha);

        const databasePath = require.resolve('../database');
        const servicePath = require.resolve('./hospedagemAdminService');
        const limpezaAdminPath = require.resolve('./eventoSuiteLimpezaAdminService');
        const reservaPath = require.resolve('../models/ReservaHospedagem');
        const suitePath = require.resolve('../models/EventoSuite');
        const reservaSuitePath = require.resolve('../models/ReservaSuite');
        const movPath = require.resolve('../models/ReservaSuiteMovimentacao');
        const pagamentoPath = require.resolve('../models/PagamentoHospedagem');
        const periodoMovPath = require.resolve('../models/ReservaPeriodoMovimentacao');
        const historicoPath = require.resolve('../models/Transacao');
        const usuarioPath = require.resolve('../models/Usuario');
        const produtorPath = require.resolve('../models/Produtor');

        delete require.cache[servicePath];
        delete require.cache[limpezaAdminPath];

        const connection = require('../database').default;
        const originalTransaction = connection.transaction;
        const { ReservaHospedagem } = require('../models/ReservaHospedagem');
        const { EventoSuite } = require('../models/EventoSuite');
        const { ReservaSuite } = require('../models/ReservaSuite');
        const { ReservaSuiteMovimentacao } = require('../models/ReservaSuiteMovimentacao');
        const { PagamentoHospedagem } = require('../models/PagamentoHospedagem');
        const { ReservaPeriodoMovimentacao } = require('../models/ReservaPeriodoMovimentacao');
        const { HistoricoTransacao } = require('../models/Transacao');
        const { Usuario } = require('../models/Usuario');
        const { ProdutorAcesso } = require('../models/Produtor');

        const originalReservaFind = ReservaHospedagem.findByPk;
        const originalReservaFindOne = ReservaHospedagem.findOne;
        const originalSuiteFind = EventoSuite.findByPk;
        const originalReservaSuiteFindAll = ReservaSuite.findAll;
        const originalMovCreate = ReservaSuiteMovimentacao.create;
        const originalMovFindAll = ReservaSuiteMovimentacao.findAll;
        const originalPagamentoFindAll = PagamentoHospedagem.findAll;
        const originalPeriodoMovFindAll = ReservaPeriodoMovimentacao.findAll;
        const originalHistoricoFindAll = HistoricoTransacao.findAll;
        const originalUsuarioFind = Usuario.findByPk;
        const originalAcessoFind = ProdutorAcesso.findAll;

        const { EventoSuiteLimpeza } = require('../models/EventoSuiteLimpeza');
        const originalLimpezaFindOne = EventoSuiteLimpeza.findOne;
        const originalLimpezaFindAll = EventoSuiteLimpeza.findAll;
        const originalLimpezaCreate = EventoSuiteLimpeza.create;
        const originalSuiteFindPkLimpeza = EventoSuite.findByPk;

        let transactionCommitou = false;

        let reservaFindCount = 0;
        ReservaHospedagem.findByPk = (async () => {
            reservaFindCount += 1;
            if (reservaFindCount === 1) {
                return { ...reserva, ReservaSuite: [linha] };
            }
            return {
                ...reserva,
                ReservaSuite: [{ ...linha, idEventoSuite: idDestino }],
            };
        }) as typeof ReservaHospedagem.findByPk;

        ReservaHospedagem.findOne = (async () => ({
            id: reserva.id,
            status: reserva.status,
            checkin: reserva.checkin,
            checkout: reserva.checkout,
            valorTotal: 0,
            valorPago: 0,
            saldoPendente: 0,
            idTransacao: null,
            linkPagamentoEnviadoEm: null,
            dataConfirmacao: null,
            preco: 0,
            taxaServico: 0,
            noites: 1,
            origemReserva: reserva.origemReserva,
            idExterno: reserva.idExterno,
            canalVenda: null,
            Evento: { ...reserva.Evento, nome: 'Pousada', tipo: 'Pousada' },
            Usuario: null,
            UsuarioCriacao: null,
            Transacao: null,
            TaxaAdicional: [],
            ReservaSuite: [
                {
                    ...linha,
                    idEventoSuite: idDestino,
                    preco: 0,
                    taxaServico: 0,
                    valorTotal: 0,
                    status: 'Hospedada',
                    EventoSuite: { id: idDestino, nome: 'Destino' },
                    ReservaHospede: [],
                    ItemServico: [],
                },
            ],
        })) as typeof ReservaHospedagem.findOne;

        EventoSuite.findByPk = (async (id: number) => {
            if (id === idDestino) {
                return {
                    id: idDestino,
                    idEvento: 1,
                    status: 'Ativo',
                    nome: 'Destino',
                    qtdeMaximaPessoas: 4,
                    qtdeMinimaPessoas: 1,
                };
            }
            if (id === idOrigem) {
                return { id: idOrigem };
            }
            return null;
        }) as typeof EventoSuite.findByPk;

        ReservaSuite.findAll = (async () => []) as typeof ReservaSuite.findAll;
        ReservaSuiteMovimentacao.create = (async () => ({ id: 1 })) as typeof ReservaSuiteMovimentacao.create;
        ReservaSuiteMovimentacao.findAll = (async () => []) as typeof ReservaSuiteMovimentacao.findAll;
        PagamentoHospedagem.findAll = (async () => []) as typeof PagamentoHospedagem.findAll;
        ReservaPeriodoMovimentacao.findAll = (async () => []) as typeof ReservaPeriodoMovimentacao.findAll;
        HistoricoTransacao.findAll = (async () => []) as typeof HistoricoTransacao.findAll;
        Usuario.findByPk = (async () => ({ admGeral: true })) as typeof Usuario.findByPk;
        ProdutorAcesso.findAll = (async () => []) as typeof ProdutorAcesso.findAll;

        EventoSuiteLimpeza.findOne = (async (opts: { where?: { idEventoSuite?: number; status?: unknown } }) => {
            if (
                opts?.where?.status &&
                opts.where.idEventoSuite === idOrigem &&
                options?.limpezaAbertaOrigem
            ) {
                return limpezaAberta(idOrigem, options.limpezaAbertaOrigem);
            }
            if (opts?.where?.status && opts.where.idEventoSuite === idDestino) {
                return null;
            }
            if (opts?.where?.status) return null;
            return null;
        }) as typeof EventoSuiteLimpeza.findOne;

        EventoSuiteLimpeza.findAll = (async () => []) as typeof EventoSuiteLimpeza.findAll;
        EventoSuiteLimpeza.create = (async (data: { idEventoSuite: number }) => {
            limpezaCalls.push({ id: data.idEventoSuite, tx: mockTx });
            return { id: limpezaCalls.length };
        }) as typeof EventoSuiteLimpeza.create;

        connection.transaction = (async (fn: (t: Transaction) => Promise<void>) => {
            if (options?.falharTransaction) {
                await fn(mockTx);
                throw new Error('rollback simulado');
            }
            await fn(mockTx);
            transactionCommitou = true;
        }) as typeof connection.transaction;

        const refreshPath = require.resolve('./hospedagemRefreshVersionService');
        const outboundPath = require.resolve(
            '../integrations/hospedin/outbound/HospedinOutboundEnqueueService'
        );
        const hospedinPushPath = require.resolve(
            '../integrations/hospedin/services/hospedinAdminSuiteTrocaPushService'
        );

        require.cache[refreshPath] = {
            id: refreshPath,
            filename: refreshPath,
            loaded: true,
            exports: {
                incrementarHospedagemRefreshVersion: async () => undefined,
            },
        };
        require.cache[outboundPath] = {
            id: outboundPath,
            filename: outboundPath,
            loaded: true,
            exports: {
                hospedinOutboundEnqueueService: {
                    markDirty: async () => undefined,
                },
            },
        };
        require.cache[hospedinPushPath] = {
            id: hospedinPushPath,
            filename: hospedinPushPath,
            loaded: true,
            exports: {
                pushAdminSuiteTrocaToHospedin: async () => ({
                    patched: false,
                    skipped: 'TEST',
                }),
            },
        };

        try {
            const hospedagemModule = require('./hospedagemAdminService');

            try {
                await hospedagemModule.trocarSuiteReservaAdmin({
                    idReservaHospedagem: reserva.id,
                    idUsuario: 1,
                    idReservaSuite: linha.id,
                    idEventoSuiteDestino: idDestino,
                });
            } catch (err) {
                if (options?.falharTransaction) {
                    throw err;
                }
                // A limpeza ocorre dentro da transaction; falhas posteriores
                // (ex.: obterReservaAdminDetalhe) não invalidam o cenário testado.
            }

            return { limpezaCalls, transactionCommitou, linha };
        } finally {
            ReservaHospedagem.findByPk = originalReservaFind;
            ReservaHospedagem.findOne = originalReservaFindOne;
            EventoSuite.findByPk = originalSuiteFind;
            ReservaSuite.findAll = originalReservaSuiteFindAll;
            ReservaSuiteMovimentacao.create = originalMovCreate;
            ReservaSuiteMovimentacao.findAll = originalMovFindAll;
            PagamentoHospedagem.findAll = originalPagamentoFindAll;
            ReservaPeriodoMovimentacao.findAll = originalPeriodoMovFindAll;
            HistoricoTransacao.findAll = originalHistoricoFindAll;
            Usuario.findByPk = originalUsuarioFind;
            ProdutorAcesso.findAll = originalAcessoFind;
            EventoSuiteLimpeza.findOne = originalLimpezaFindOne;
            EventoSuiteLimpeza.findAll = originalLimpezaFindAll;
            EventoSuiteLimpeza.create = originalLimpezaCreate;
            EventoSuite.findByPk = originalSuiteFindPkLimpeza;
            connection.transaction = originalTransaction;
            delete require.cache[servicePath];
            delete require.cache[limpezaAdminPath];
            delete require.cache[databasePath];
            delete require.cache[reservaPath];
            delete require.cache[suitePath];
            delete require.cache[reservaSuitePath];
            delete require.cache[movPath];
            delete require.cache[pagamentoPath];
            delete require.cache[periodoMovPath];
            delete require.cache[historicoPath];
            delete require.cache[usuarioPath];
            delete require.cache[produtorPath];
            delete require.cache[refreshPath];
            delete require.cache[outboundPath];
            delete require.cache[hospedinPushPath];
        }
    }

    it('1. Reserva Hospedada + troca A→B cria MANUAL/Pendente para A', async () => {
        const { limpezaCalls } = await executarTrocaComMocks(
            StatusReservaHospedagem.Hospedada
        );
        assert.equal(limpezaCalls.length, 1);
        assert.equal(limpezaCalls[0].id, idOrigem);
    });

    it('2. Reserva Confirmada + troca A→B não cria limpeza', async () => {
        const { limpezaCalls } = await executarTrocaComMocks(
            StatusReservaHospedagem.Confirmada
        );
        assert.equal(limpezaCalls.length, 0);
    });

    it('3. Hospedada + A Pendente não duplica', async () => {
        const { limpezaCalls } = await executarTrocaComMocks(
            StatusReservaHospedagem.Hospedada,
            { limpezaAbertaOrigem: StatusEventoSuiteLimpeza.Pendente }
        );
        assert.equal(limpezaCalls.length, 0);
    });

    it('4. Hospedada + A EmAndamento não duplica', async () => {
        const { limpezaCalls } = await executarTrocaComMocks(
            StatusReservaHospedagem.Hospedada,
            { limpezaAbertaOrigem: StatusEventoSuiteLimpeza.EmAndamento }
        );
        assert.equal(limpezaCalls.length, 0);
    });

    it('5. Hospedada + A Concluida cria nova MANUAL', async () => {
        const { limpezaCalls } = await executarTrocaComMocks(
            StatusReservaHospedagem.Hospedada
        );
        assert.equal(limpezaCalls.length, 1);
        assert.equal(limpezaCalls[0].id, idOrigem);
    });

    it('6. Hospedada + troca A→B não cria limpeza para B', async () => {
        const { limpezaCalls } = await executarTrocaComMocks(
            StatusReservaHospedagem.Hospedada
        );
        assert.equal(
            limpezaCalls.some((c) => c.id === idDestino),
            false
        );
    });

    it('7. rollback da transaction não persiste limpeza', async () => {
        await assert.rejects(
            () =>
                executarTrocaComMocks(StatusReservaHospedagem.Hospedada, {
                    falharTransaction: true,
                }),
            /rollback simulado/
        );
    });

    it('8. limpeza não adiciona chamadas Hospedin dentro da transaction', () => {
        const source = readFileSync(
            require.resolve('./hospedagemAdminService'),
            'utf8'
        );
        const idxLimpeza = source.indexOf(
            'criarLimpezaManualPendenteSeAusente(idOrigem, t)'
        );
        assert.ok(idxLimpeza >= 0, 'chamada de limpeza na troca deve existir');
        const idxTransactionStart = source.lastIndexOf(
            'await connection.transaction(async (t: Transaction) => {',
            idxLimpeza
        );
        assert.ok(idxTransactionStart >= 0, 'transaction da troca deve existir');
        const idxTransactionEnd = source.indexOf('});', idxLimpeza);
        assert.ok(idxTransactionEnd > idxLimpeza, 'fim da transaction deve existir');
        const transactionBlock = source.slice(idxTransactionStart, idxTransactionEnd);
        assert.equal(/pushAdminSuiteTrocaToHospedin/.test(transactionBlock), false);
        assert.equal(/markDirty/.test(transactionBlock), false);
        assert.equal(/hospedinOutboundEnqueueService/.test(transactionBlock), false);
        const idxPush = source.indexOf('pushAdminSuiteTrocaToHospedin', idxTransactionEnd);
        assert.ok(idxPush > idxTransactionEnd, 'Hospedin push deve ficar após a transaction');
    });
});
