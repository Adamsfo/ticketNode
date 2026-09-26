/**
 * Testes unitários — reativação de reserva expirada.
 *
 * NÃO conecta ao banco real, NÃO altera registros, NÃO chama Hospedin/WhatsApp/e-mail.
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/services/hospedagemReativacaoAdminService.test.ts
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Transaction } from 'sequelize';
import { StatusReservaHospedagem } from '../models/ReservaHospedagem';
import { StatusReservaSuite } from '../models/ReservaSuite';
import { HospedinOutboundStatus } from '../models/HospedinOutboundSyncState';
import { CustomError } from '../utils/customError';
import {
    MINUTOS_EXPIRACAO_LINK_PAGAMENTO,
    MINUTOS_EXPIRACAO_RESERVA_ONLINE,
    calcularExpiraEmLinkPagamento,
    calcularExpiraEmReservaOnline,
} from './reservaHospedagemExpiracaoUtils';
import {
    avaliarOutboundReativacao,
    avaliarStatusReativacao,
    avaliarTransacaoReativacao,
    formatarPeriodoConflitoReativacao,
    montarMensagemConflitoReativacao,
    resolverPrazoReativacao,
} from './hospedagemReativacaoAdminPolicy';

const mockTx = {
    LOCK: { UPDATE: 'UPDATE' },
} as unknown as Transaction;

function limparCacheModulosReativacao() {
    const paths = [
        './hospedagemReativacaoAdminService',
        './hospedagemAdminService',
        './hospedagemRefreshVersionService',
        './hospedagemConfirmacaoNotificacao',
        '../integrations/hospedin/outbound/HospedinOutboundEnqueueService',
    ];
    for (const p of paths) {
        try {
            delete require.cache[require.resolve(p)];
        } catch {
            // ignore
        }
    }
}

describe('R-REACT-01 — reativação com suíte disponível (regras puras)', () => {
    it('aceita somente status Expirada', () => {
        assert.deepEqual(
            avaliarStatusReativacao(StatusReservaHospedagem.Expirada),
            { ok: true }
        );
    });

    it('fluxo link gera novo token e expiraEm em 30 minutos', () => {
        const agora = new Date('2026-09-19T12:00:00.000Z');
        const prazo = resolverPrazoReativacao({
            tokenPagamento: 'token-antigo',
            agora,
        });

        assert.equal(prazo.gerarNovoToken, true);
        assert.equal(
            prazo.expiraEm.getTime(),
            calcularExpiraEmLinkPagamento(agora).getTime()
        );
        assert.equal(MINUTOS_EXPIRACAO_LINK_PAGAMENTO, 30);
    });
});

describe('R-REACT-02 — conflito de suíte', () => {
    it('monta mensagem 409 amigável para uma suíte', () => {
        const mensagem = montarMensagemConflitoReativacao(
            [{ nomeSuite: 'Suíte 1' }],
            '19/09/2026 às 16:00 até 20/09/2026 às 13:00'
        );

        assert.match(mensagem, /Não foi possível reativar a reserva/);
        assert.match(mensagem, /Suíte 1/);
        assert.match(mensagem, /permanece expirada/);
    });

    it('lista múltiplas suítes indisponíveis', () => {
        const mensagem = montarMensagemConflitoReativacao(
            [{ nomeSuite: 'Suíte 1' }, { nomeSuite: 'Suíte 2' }],
            '19/09/2026 às 16:00 até 20/09/2026 às 13:00'
        );

        assert.match(mensagem, /Suíte 1/);
        assert.match(mensagem, /Suíte 2/);
    });
});

describe('R-REACT-03 — reserva online', () => {
    it('define expiraEm explícito em 15 minutos sem novo token', () => {
        const agora = new Date('2026-09-19T12:00:00.000Z');
        const prazo = resolverPrazoReativacao({
            origemReserva: 'CLIENTE',
            tokenPagamento: null,
            linkPagamentoEnviadoEm: null,
            agora,
        });

        assert.equal(prazo.gerarNovoToken, false);
        assert.equal(
            prazo.expiraEm.getTime(),
            calcularExpiraEmReservaOnline(agora).getTime()
        );
        assert.equal(MINUTOS_EXPIRACAO_RESERVA_ONLINE, 15);
    });
});

describe('R-REACT-04 — reserva enviada pela recepção', () => {
    it('considera link enviado como fluxo com novo token e 30 minutos', () => {
        const agora = new Date('2026-09-19T12:00:00.000Z');
        const prazo = resolverPrazoReativacao({
            origemReserva: 'ATENDENTE',
            tokenPagamento: null,
            linkPagamentoEnviadoEm: '2026-09-19T11:00:00.000Z',
            agora,
        });

        assert.equal(prazo.gerarNovoToken, true);
        assert.equal(
            prazo.expiraEm.getTime() - agora.getTime(),
            30 * 60 * 1000
        );
    });
});

describe('R-REACT-05 — transação reutilizável', () => {
    it('aceita transação Aguardando pagamento', () => {
        assert.deepEqual(
            avaliarTransacaoReativacao({ status: 'Aguardando pagamento' }),
            { ok: true }
        );
    });

    it('rejeita transação em outro status', () => {
        const resultado = avaliarTransacaoReativacao({ status: 'Pago' });
        assert.equal(resultado.ok, false);
        if (!resultado.ok) {
            assert.match(resultado.message, /não pode ser reutilizada/);
        }
    });
});

describe('R-REACT-06 — Hospedin', () => {
    it('não marca dirty para origem HOSPEDIN', () => {
        const resultado = avaliarOutboundReativacao({
            origemReserva: 'HOSPEDIN',
            suites: [{ hospedinReservationId: null }],
        });

        assert.deepEqual(resultado, { ok: true, deveMarkDirty: false });
    });

    it('permite markDirty quando ainda não houve vínculo Hospedin', () => {
        const resultado = avaliarOutboundReativacao({
            origemReserva: 'CLIENTE',
            eventoTipo: 'Pousada',
            suites: [{ hospedinReservationId: null }],
            outboundState: null,
        });

        assert.deepEqual(resultado, { ok: true, deveMarkDirty: true });
    });

    it('bloqueia vínculo parcial multi-suíte', () => {
        const resultado = avaliarOutboundReativacao({
            origemReserva: 'CLIENTE',
            eventoTipo: 'Pousada',
            suites: [
                { hospedinReservationId: '111' },
                { hospedinReservationId: null },
            ],
        });

        assert.equal(resultado.ok, false);
        if (!resultado.ok) {
            assert.match(resultado.message, /vínculo parcial/);
        }
    });

    it('reutiliza vínculo existente sem exigir novo CREATE', () => {
        const resultado = avaliarOutboundReativacao({
            origemReserva: 'CLIENTE',
            eventoTipo: 'Pousada',
            idExterno: '30295972',
            suites: [{ hospedinReservationId: '30295972' }],
            outboundState: {
                outbound_status: HospedinOutboundStatus.SYNCED,
                desired_action: 'UPDATE',
                last_error: null,
                hospedin_reservation_id: '30295972',
            },
        });

        assert.deepEqual(resultado, { ok: true, deveMarkDirty: true });
    });
});

describe('R-REACT-07 — concorrência / status', () => {
    it('rejeita reativação quando já está AguardandoPagamento', () => {
        const resultado = avaliarStatusReativacao(
            StatusReservaHospedagem.AguardandoPagamento
        );
        assert.equal(resultado.ok, false);
        if (!resultado.ok) {
            assert.equal(resultado.statusCode, 400);
            assert.match(resultado.message, /já está aguardando pagamento/);
        }
    });
});

describe('R-REACT-08 — multi-suíte (mensagens)', () => {
    it('formata período para mensagem de conflito', () => {
        const texto = formatarPeriodoConflitoReativacao(
            new Date('2026-09-19T20:00:00.000Z'),
            new Date('2026-09-20T17:00:00.000Z')
        );
        assert.match(texto, /19\/09\/2026/);
        assert.match(texto, /20\/09\/2026/);
    });
});

describe('avaliarOutboundReativacao — ABORTED por error_code (Expirada)', () => {
    const baseInput = {
        origemReserva: 'CLIENTE',
        eventoTipo: 'Pousada',
        suites: [{ hospedinReservationId: null }],
    };

    it('A — ABORTED / STATUS_TERMINAL → ok, deveMarkDirty', () => {
        const resultado = avaliarOutboundReativacao({
            ...baseInput,
            outboundState: {
                outbound_status: HospedinOutboundStatus.ABORTED,
                desired_action: 'CREATE',
                last_error: 'Status Expirada não elegível para CREATE outbound.',
                error_code: 'STATUS_TERMINAL',
                hospedin_reservation_id: null,
            },
        });
        assert.deepEqual(resultado, { ok: true, deveMarkDirty: true });
    });

    it('B — ABORTED / OUTBOUND_OPERATIONAL_WINDOW → ok, deveMarkDirty', () => {
        const resultado = avaliarOutboundReativacao({
            ...baseInput,
            outboundState: {
                outbound_status: HospedinOutboundStatus.ABORTED,
                desired_action: 'CREATE',
                last_error: 'fora da janela operacional',
                error_code: 'OUTBOUND_OPERATIONAL_WINDOW',
                hospedin_reservation_id: null,
            },
        });
        assert.deepEqual(resultado, { ok: true, deveMarkDirty: true });
    });

    it('C — ABORTED / CREATE_ABORTED → ok false', () => {
        const resultado = avaliarOutboundReativacao({
            ...baseInput,
            outboundState: {
                outbound_status: HospedinOutboundStatus.ABORTED,
                desired_action: 'CANCEL',
                last_error: 'abort',
                error_code: 'CREATE_ABORTED',
                hospedin_reservation_id: null,
            },
        });
        assert.equal(resultado.ok, false);
    });

    it('D — ABORTED / outro error_code → mantém bloqueio genérico', () => {
        const resultado = avaliarOutboundReativacao({
            ...baseInput,
            outboundState: {
                outbound_status: HospedinOutboundStatus.ABORTED,
                desired_action: 'CREATE',
                last_error: 'falha permanente',
                error_code: 'MAPPING_BLOCKED',
                hospedin_reservation_id: null,
            },
        });
        assert.equal(resultado.ok, false);
        if (!resultado.ok) {
            assert.match(resultado.message, /abortada/);
        }
    });
});

describe('R-REACT-09 — rollback (validações antes da transação)', () => {
    it('bloqueia outbound abortado (CREATE_ABORTED) antes de qualquer alteração', () => {
        const resultado = avaliarOutboundReativacao({
            origemReserva: 'CLIENTE',
            eventoTipo: 'Pousada',
            suites: [{ hospedinReservationId: null }],
            outboundState: {
                outbound_status: HospedinOutboundStatus.ABORTED,
                desired_action: 'CREATE',
                last_error: 'abort',
                error_code: 'CREATE_ABORTED',
                hospedin_reservation_id: null,
            },
        });

        assert.equal(resultado.ok, false);
    });

    it('permite reativação com ABORTED + STATUS_TERMINAL (expirada outbound)', () => {
        const resultado = avaliarOutboundReativacao({
            origemReserva: 'CLIENTE',
            eventoTipo: 'Pousada',
            suites: [{ hospedinReservationId: null }],
            outboundState: {
                outbound_status: HospedinOutboundStatus.ABORTED,
                desired_action: 'CREATE',
                last_error:
                    'Status Expirada não elegível para CREATE outbound.',
                error_code: 'STATUS_TERMINAL',
                hospedin_reservation_id: null,
            },
        });

        assert.deepEqual(resultado, { ok: true, deveMarkDirty: true });
    });

    it('bloqueia transação inválida antes de alterar status', () => {
        const resultado = avaliarTransacaoReativacao({ status: 'Cancelado' });
        assert.equal(resultado.ok, false);
    });
});

describe('reativarReservaExpiradaAdmin — orquestração com mocks (sem banco real)', () => {
    afterEach(() => {
        limparCacheModulosReativacao();
    });

    async function executarReativacaoComMocks(options: {
        statusInicial: StatusReservaHospedagem;
        statusLocked?: StatusReservaHospedagem;
        origemReserva?: string;
        tokenPagamento?: string | null;
        linkPagamentoEnviadoEm?: Date | null;
        suiteTemConflito?: boolean;
        transacaoStatus?: string | null;
        suites?: Array<{
            id: number;
            idEventoSuite: number;
            nome: string;
        }>;
    }) {
        limparCacheModulosReativacao();

        const {
            ReservaHospedagem,
        } = require('../models/ReservaHospedagem');
        const { ReservaSuite } = require('../models/ReservaSuite');
        const { EventoSuite } = require('../models/EventoSuite');
        const { Transacao, HistoricoTransacao } = require('../models/Transacao');
        const { HospedinOutboundSyncState } = require('../models/HospedinOutboundSyncState');
        const connection = require('../database').default;

        const checkin = new Date('2026-09-19T20:00:00.000Z');
        const checkout = new Date('2026-09-20T17:00:00.000Z');
        const suitesConfig =
            options.suites ?? [{ id: 1, idEventoSuite: 10, nome: 'Suíte 1' }];

        const reserva = {
            id: 146,
            idTransacao: 9001,
            status: options.statusInicial,
            origemReserva: options.origemReserva ?? 'ATENDENTE',
            tokenPagamento:
                options.tokenPagamento !== undefined
                    ? options.tokenPagamento
                    : 'token-antigo',
            linkPagamentoEnviadoEm:
                options.linkPagamentoEnviadoEm !== undefined
                    ? options.linkPagamentoEnviadoEm
                    : new Date(),
            checkin,
            checkout,
            idExterno: null,
            update: async (data: Record<string, unknown>) => {
                Object.assign(reserva, data);
            },
            Evento: { id: 5, tipo: 'Pousada' },
            ReservaSuite: suitesConfig.map((suite) => ({
                id: suite.id,
                idEventoSuite: suite.idEventoSuite,
                hospedinReservationId: null,
                status: StatusReservaSuite.Expirada,
                EventoSuite: { id: suite.idEventoSuite, nome: suite.nome },
                update: async (data: Record<string, unknown>) => {
                    Object.assign(
                        reserva.ReservaSuite.find((s: { id: number }) => s.id === suite.id)!,
                        data
                    );
                },
            })),
        };

        const reservaLocked = {
            ...reserva,
            status: options.statusLocked ?? options.statusInicial,
            update: reserva.update,
        };

        let historicoCriado = false;
        let notificacaoChamada = false;
        let markDirtyChamado = false;
        let tokenGerado: string | null = null;

        const originalFindByPkReserva = ReservaHospedagem.findByPk;
        const originalFindAllSuite = ReservaSuite.findAll;
        const originalFindByPkSuite = EventoSuite.findByPk;
        const originalFindByPkTransacao = Transacao.findByPk;
        const originalOutboundFindOne = HospedinOutboundSyncState.findOne;
        const originalHistoricoCreate = HistoricoTransacao.create;
        const originalTransaction = connection.transaction;

        ReservaHospedagem.findByPk = (async (id: number, opts?: { transaction?: Transaction }) => {
            if (opts?.transaction) {
                return reservaLocked;
            }
            return reserva;
        }) as typeof ReservaHospedagem.findByPk;

        ReservaSuite.findAll = (async () =>
            reserva.ReservaSuite.map((suite: Record<string, unknown>) => ({
                ...suite,
                update: suite.update,
            }))) as typeof ReservaSuite.findAll;

        EventoSuite.findByPk = (async (id: number) => ({
            id,
            nome: suitesConfig.find((s) => s.idEventoSuite === id)?.nome ?? `Suíte ${id}`,
            status: 'Ativo',
        })) as typeof EventoSuite.findByPk;

        Transacao.findByPk = (async () =>
            options.transacaoStatus
                ? { status: options.transacaoStatus }
                : null) as typeof Transacao.findByPk;

        HospedinOutboundSyncState.findOne = (async () => null) as typeof HospedinOutboundSyncState.findOne;

        HistoricoTransacao.create = (async () => {
            historicoCriado = true;
            return { id: 1 };
        }) as typeof HistoricoTransacao.create;

        connection.transaction = (async (fn: (t: Transaction) => Promise<void>) => {
            await fn(mockTx);
        }) as typeof connection.transaction;

        const adminPath = require.resolve('./hospedagemAdminService');
        const refreshPath = require.resolve('./hospedagemRefreshVersionService');
        const notificacaoPath = require.resolve('./hospedagemConfirmacaoNotificacao');
        const outboundPath = require.resolve(
            '../integrations/hospedin/outbound/HospedinOutboundEnqueueService'
        );
        const reservaSuitePath = require.resolve('./reservaSuiteService');

        require.cache[adminPath] = {
            id: adminPath,
            filename: adminPath,
            loaded: true,
            exports: {
                obterReservaAdminDetalhe: async () => ({ id: reserva.id }),
            },
        };
        require.cache[refreshPath] = {
            id: refreshPath,
            filename: refreshPath,
            loaded: true,
            exports: { incrementarHospedagemRefreshVersion: async () => undefined },
        };
        require.cache[notificacaoPath] = {
            id: notificacaoPath,
            filename: notificacaoPath,
            loaded: true,
            exports: {
                notificarLinkPagamentoHospedagem: async () => {
                    notificacaoChamada = true;
                    return { linkPagamento: 'https://example.com/reserva/mock' };
                },
            },
        };
        require.cache[outboundPath] = {
            id: outboundPath,
            filename: outboundPath,
            loaded: true,
            exports: {
                hospedinOutboundEnqueueService: {
                    markDirty: async () => {
                        markDirtyChamado = true;
                    },
                },
            },
        };

        const suiteTemConflitoOriginal =
            require(reservaSuitePath).suiteTemConflito;
        require(reservaSuitePath).suiteTemConflito = async () =>
            Boolean(options.suiteTemConflito);
        require(reservaSuitePath).gerarTokenPagamentoReserva = () => {
            tokenGerado = 'novo-token-mock-reativacao';
            return tokenGerado;
        };

        try {
            delete require.cache[require.resolve('./hospedagemReativacaoAdminService')];
        } catch {
            // ignore
        }
        const { reativarReservaExpiradaAdmin } = require('./hospedagemReativacaoAdminService');

        let erro: unknown;
        let resultado: { id: number; notificacaoEnviada: boolean } | undefined;
        try {
            resultado = await reativarReservaExpiradaAdmin({
                idReservaHospedagem: reserva.id,
                idUsuarioOperador: 99,
            });
        } catch (error) {
            erro = error;
        } finally {
            ReservaHospedagem.findByPk = originalFindByPkReserva;
            ReservaSuite.findAll = originalFindAllSuite;
            EventoSuite.findByPk = originalFindByPkSuite;
            Transacao.findByPk = originalFindByPkTransacao;
            HospedinOutboundSyncState.findOne = originalOutboundFindOne;
            HistoricoTransacao.create = originalHistoricoCreate;
            connection.transaction = originalTransaction;
            require(reservaSuitePath).suiteTemConflito = suiteTemConflitoOriginal;
        }

        return {
            erro,
            resultado,
            reserva,
            historicoCriado,
            notificacaoChamada,
            markDirtyChamado,
            tokenGerado,
        };
    }

    it('R-REACT-01 — Expirada + disponível → AguardandoPagamento, token, expiraEm, histórico', async () => {
        const exec = await executarReativacaoComMocks({
            statusInicial: StatusReservaHospedagem.Expirada,
            suiteTemConflito: false,
        });

        assert.equal(exec.erro, undefined);
        assert.equal(exec.reserva.status, StatusReservaHospedagem.AguardandoPagamento);
        assert.equal(exec.reserva.tokenPagamento, 'novo-token-mock-reativacao');
        assert.ok(exec.reserva.expiraEm instanceof Date);
        assert.equal(exec.historicoCriado, true);
        assert.equal(exec.notificacaoChamada, true);
        assert.equal(exec.markDirtyChamado, true);
        assert.equal(exec.resultado?.notificacaoEnviada, true);
        for (const suite of exec.reserva.ReservaSuite) {
            assert.equal(suite.status, StatusReservaSuite.AguardandoPagamento);
        }
    });

    it('R-REACT-02 — suíte ocupada → 409, permanece Expirada, sem notificação', async () => {
        const exec = await executarReativacaoComMocks({
            statusInicial: StatusReservaHospedagem.Expirada,
            suiteTemConflito: true,
        });

        assert.ok(exec.erro instanceof CustomError);
        assert.equal((exec.erro as CustomError).statusCode, 409);
        assert.equal(exec.reserva.status, StatusReservaHospedagem.Expirada);
        assert.equal(exec.reserva.tokenPagamento, 'token-antigo');
        assert.equal(exec.historicoCriado, false);
        assert.equal(exec.notificacaoChamada, false);
        assert.equal(exec.markDirtyChamado, false);
    });

    it('R-REACT-03 — online sem token → expiraEm 15 min, sem notificação', async () => {
        const antes = Date.now();
        const exec = await executarReativacaoComMocks({
            statusInicial: StatusReservaHospedagem.Expirada,
            origemReserva: 'CLIENTE',
            tokenPagamento: null,
            linkPagamentoEnviadoEm: null,
            suiteTemConflito: false,
        });
        const depois = Date.now();

        assert.equal(exec.erro, undefined);
        assert.equal(exec.reserva.tokenPagamento, null);
        assert.ok(exec.reserva.expiraEm instanceof Date);
        const expiraMs = exec.reserva.expiraEm.getTime();
        assert.ok(expiraMs >= antes + 14 * 60 * 1000);
        assert.ok(expiraMs <= depois + 16 * 60 * 1000);
        assert.equal(exec.notificacaoChamada, false);
    });

    it('R-REACT-07 — segunda tentativa com status já reativado → 409', async () => {
        const exec = await executarReativacaoComMocks({
            statusInicial: StatusReservaHospedagem.Expirada,
            statusLocked: StatusReservaHospedagem.AguardandoPagamento,
            suiteTemConflito: false,
        });

        assert.ok(exec.erro instanceof CustomError);
        assert.equal((exec.erro as CustomError).statusCode, 409);
        assert.match(
            String((exec.erro as CustomError).message),
            /já foi reativada/
        );
        assert.equal(exec.historicoCriado, false);
        assert.equal(exec.notificacaoChamada, false);
    });

    it('R-REACT-08 — multi-suíte: uma indisponível bloqueia todas', async () => {
        const exec = await executarReativacaoComMocks({
            statusInicial: StatusReservaHospedagem.Expirada,
            suites: [
                { id: 1, idEventoSuite: 10, nome: 'Suíte 1' },
                { id: 2, idEventoSuite: 11, nome: 'Suíte 2' },
            ],
            suiteTemConflito: true,
        });

        assert.ok(exec.erro instanceof CustomError);
        assert.equal((exec.erro as CustomError).statusCode, 409);
        assert.equal(exec.reserva.status, StatusReservaHospedagem.Expirada);
        assert.equal(exec.historicoCriado, false);
    });
});
