/**
 * Testes unitários — checkout automático de hospedagem (sem banco/PDV real).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { StatusReservaHospedagem } from '../models/ReservaHospedagem';
import { StatusReservaSuite } from '../models/ReservaSuite';
import { VendaJangoStatus } from '../api/hospedagemVendaJangoReadService';
import { MARGEM_SEGURANCA_CHECKOUT_AUTOMATICO_MS } from './hospedagemCheckoutAutomaticoPolicy';

const AGORA = new Date('2026-09-21T06:00:00.000Z');
const CHECKOUT = new Date(
    AGORA.getTime() - MARGEM_SEGURANCA_CHECKOUT_AUTOMATICO_MS - 120_000
);

function limparCacheModulos() {
    const paths = [
        './hospedagemCheckoutAutomaticoService',
        '../models/ReservaHospedagem',
        '../integrations/hospedin/constants/config',
    ];
    for (const p of paths) {
        try {
            delete require.cache[require.resolve(p)];
        } catch {
            // ignore
        }
    }
}

describe('resolverIdUsuarioCheckoutAutomatico — usuário Hospedin', () => {
    const envAnterior = {
        syncUser: process.env.HOSPEDIN_SYNC_USER_ID,
    };

    afterEach(() => {
        process.env.HOSPEDIN_SYNC_USER_ID = envAnterior.syncUser;
        limparCacheModulos();
    });

    it('reutiliza HOSPEDIN_SYNC_USER_ID via getHospedinConfig', async () => {
        limparCacheModulos();
        process.env.HOSPEDIN_SYNC_USER_ID = '42';
        const { resolverIdUsuarioCheckoutAutomatico } = require(
            './hospedagemCheckoutAutomaticoService'
        );
        const id = await resolverIdUsuarioCheckoutAutomatico();
        assert.equal(id, 42);
    });

    it('falha quando HOSPEDIN_SYNC_USER_ID não está configurado', async () => {
        limparCacheModulos();
        delete process.env.HOSPEDIN_SYNC_USER_ID;
        const { resolverIdUsuarioCheckoutAutomatico } = require(
            './hospedagemCheckoutAutomaticoService'
        );
        await assert.rejects(
            () => resolverIdUsuarioCheckoutAutomatico(),
            /HOSPEDIN_SYNC_USER_ID/
        );
    });
});

describe('executarCheckoutAutomaticoDiario — orquestração', () => {
    const envAnterior = {
        syncUser: process.env.HOSPEDIN_SYNC_USER_ID,
    };

    afterEach(() => {
        process.env.HOSPEDIN_SYNC_USER_ID = envAnterior.syncUser;
        limparCacheModulos();
    });

    type SuiteMock = {
        id: number;
        status: StatusReservaSuite;
        dataHoraCheckoutRealizado?: Date | null;
        idUsuarioCheckout?: number | null;
    };

    async function executarComMocks(options: {
        candidatas: Array<{
            id: number;
            idVendaJango: number;
            checkout?: Date;
        }>;
        suitesPorReserva?: Record<number, SuiteMock[]>;
        consultarVenda?: (
            idVenda: number
        ) => Promise<
            | { ok: true; venda: { status: number; idVenda: number } }
            | { ok: false; motivo: 'NAO_ENCONTRADA' | 'ERRO_COMUNICACAO' }
        >;
        realizarCheckoutSuite?: (
            idReserva: number,
            idReservaSuite: number,
            idUsuario: number,
            dataHora: Date
        ) => Promise<void>;
        realizarCheckoutAdmin?: () => Promise<void>;
        realizarCheckoutSuiteThrows?: boolean;
    }) {
        limparCacheModulos();
        process.env.HOSPEDIN_SYNC_USER_ID = '7';

        const checkoutSuiteChamadas: Array<{
            idReserva: number;
            idReservaSuite: number;
            idUsuario: number;
            dataHora: Date;
        }> = [];
        let checkoutAdminChamadas = 0;
        const dataHoraCheckoutRecebida: Date[] = [];

        const suitesPorReserva = options.suitesPorReserva ?? {};

        const consultarVenda =
            options.consultarVenda ??
            (async (idVenda: number) => ({
                ok: true as const,
                venda: {
                    idVenda,
                    status: VendaJangoStatus.Fechado,
                },
            }));

        const realizarCheckoutSuite =
            options.realizarCheckoutSuite ??
            (async (
                idReserva: number,
                idReservaSuite: number,
                idUsuario: number,
                dataHora: Date
            ) => {
                checkoutSuiteChamadas.push({
                    idReserva,
                    idReservaSuite,
                    idUsuario,
                    dataHora,
                });
                dataHoraCheckoutRecebida.push(dataHora);
                if (options.realizarCheckoutSuiteThrows) {
                    throw new Error('falha checkout');
                }
                const suites = suitesPorReserva[idReserva] ?? [];
                const suite = suites.find((s) => s.id === idReservaSuite);
                if (suite) {
                    suite.status = StatusReservaSuite.CheckOutRealizado;
                    suite.dataHoraCheckoutRealizado = dataHora;
                    suite.idUsuarioCheckout = idUsuario;
                }
            });

        const realizarCheckoutAdmin =
            options.realizarCheckoutAdmin ??
            (async () => {
                checkoutAdminChamadas += 1;
            });

        const { executarCheckoutAutomaticoDiario } = require(
            './hospedagemCheckoutAutomaticoService'
        );

        const resultado = await executarCheckoutAutomaticoDiario(AGORA, {
            resolverUsuario: async () => 7,
            listarCandidatas: async () =>
                options.candidatas.map((c) => ({
                    id: c.id,
                    status: StatusReservaHospedagem.Hospedada,
                    idVendaJango: c.idVendaJango,
                    checkout: c.checkout ?? CHECKOUT,
                    idTransacao: 1000 + c.id,
                })),
            consultarVenda,
            listarSuites: async (idReserva) =>
                (suitesPorReserva[idReserva] ?? []).map((suite) => ({
                    id: suite.id,
                    status: suite.status,
                    dataHoraCheckoutRealizado:
                        suite.dataHoraCheckoutRealizado ?? null,
                    idUsuarioCheckout: suite.idUsuarioCheckout ?? null,
                })),
            realizarCheckoutSuite,
            realizarCheckoutAdmin,
        });

        return {
            resultado,
            checkoutSuiteChamadas,
            checkoutAdminChamadas,
            dataHoraCheckoutRecebida,
            suitesPorReserva,
        };
    }

    it('conta fechada — executa checkout com data retroativa do checkout previsto', async () => {
        const checkoutPrevisto = new Date('2026-09-20T17:00:00.000Z');
        const { resultado, checkoutSuiteChamadas, dataHoraCheckoutRecebida } =
            await executarComMocks({
                candidatas: [{ id: 141, idVendaJango: 55289, checkout: checkoutPrevisto }],
                suitesPorReserva: {
                    141: [{ id: 501, status: StatusReservaSuite.Hospedada }],
                },
            });

        assert.equal(resultado.checkoutExecutados, 1);
        assert.equal(checkoutSuiteChamadas.length, 1);
        assert.equal(
            dataHoraCheckoutRecebida[0]?.toISOString(),
            checkoutPrevisto.toISOString()
        );
    });

    it('conta aberta — não executa checkout', async () => {
        const { resultado, checkoutSuiteChamadas } = await executarComMocks({
            candidatas: [{ id: 141, idVendaJango: 55289 }],
            suitesPorReserva: {
                141: [{ id: 501, status: StatusReservaSuite.Hospedada }],
            },
            consultarVenda: async () => ({
                ok: true,
                venda: { idVenda: 55289, status: VendaJangoStatus.Aberto },
            }),
        });

        assert.equal(resultado.checkoutExecutados, 0);
        assert.equal(resultado.ignoradas, 1);
        assert.equal(checkoutSuiteChamadas.length, 0);
        assert.equal(resultado.itens[0]?.acao, 'IGNORAR_CONTA_ABERTA');
    });

    it('conta cancelada — não executa checkout', async () => {
        const { resultado, checkoutSuiteChamadas } = await executarComMocks({
            candidatas: [{ id: 142, idVendaJango: 55290 }],
            suitesPorReserva: {
                142: [{ id: 502, status: StatusReservaSuite.Hospedada }],
            },
            consultarVenda: async () => ({
                ok: true,
                venda: { idVenda: 55290, status: VendaJangoStatus.Cancelado },
            }),
        });

        assert.equal(checkoutSuiteChamadas.length, 0);
        assert.equal(resultado.itens[0]?.acao, 'IGNORAR_VENDA_CANCELADA');
    });

    it('venda inexistente — não executa checkout', async () => {
        const { resultado, checkoutSuiteChamadas } = await executarComMocks({
            candidatas: [{ id: 143, idVendaJango: 99999 }],
            suitesPorReserva: {
                143: [{ id: 503, status: StatusReservaSuite.Hospedada }],
            },
            consultarVenda: async () => ({
                ok: false,
                motivo: 'NAO_ENCONTRADA',
            }),
        });

        assert.equal(checkoutSuiteChamadas.length, 0);
        assert.equal(resultado.itens[0]?.acao, 'IGNORAR_VENDA_INEXISTENTE');
    });

    it('erro no PDV — não executa checkout e continua', async () => {
        const { resultado, checkoutSuiteChamadas } = await executarComMocks({
            candidatas: [
                { id: 144, idVendaJango: 1 },
                { id: 145, idVendaJango: 55291 },
            ],
            suitesPorReserva: {
                144: [{ id: 504, status: StatusReservaSuite.Hospedada }],
                145: [{ id: 505, status: StatusReservaSuite.Hospedada }],
            },
            consultarVenda: async (idVenda) => {
                if (idVenda === 1) {
                    return { ok: false, motivo: 'ERRO_COMUNICACAO' };
                }
                return {
                    ok: true,
                    venda: { idVenda, status: VendaJangoStatus.Fechado },
                };
            },
        });

        assert.equal(checkoutSuiteChamadas.length, 1);
        assert.equal(resultado.checkoutExecutados, 1);
        assert.equal(resultado.ignoradas, 1);
        assert.equal(resultado.itens[0]?.acao, 'IGNORAR_ERRO_PDV');
    });

    it('erro no checkout — registra falha e continua próxima reserva', async () => {
        const { resultado, checkoutSuiteChamadas } = await executarComMocks({
            candidatas: [
                { id: 146, idVendaJango: 55292 },
                { id: 147, idVendaJango: 55293 },
            ],
            suitesPorReserva: {
                146: [{ id: 506, status: StatusReservaSuite.Hospedada }],
                147: [{ id: 507, status: StatusReservaSuite.Hospedada }],
            },
            realizarCheckoutSuiteThrows: true,
        });

        assert.equal(checkoutSuiteChamadas.length, 2);
        assert.equal(resultado.checkoutExecutados, 0);
        assert.equal(resultado.falhas, 2);
        assert.ok(resultado.itens.every((i) => i.erro));
    });

    it('multi-suíte — processa cada reserva candidata', async () => {
        const { resultado, checkoutSuiteChamadas } = await executarComMocks({
            candidatas: [
                { id: 34, idVendaJango: 55272 },
                { id: 134, idVendaJango: 55273 },
            ],
            suitesPorReserva: {
                34: [{ id: 601, status: StatusReservaSuite.Hospedada }],
                134: [{ id: 602, status: StatusReservaSuite.Hospedada }],
            },
        });

        assert.equal(resultado.candidatas, 2);
        assert.equal(checkoutSuiteChamadas.length, 2);
        assert.equal(resultado.checkoutExecutados, 2);
    });

    it('multi-suíte parcial — preserva auditoria da suíte já finalizada', async () => {
        const checkoutManual = new Date('2026-09-20T14:30:00.000Z');
        const checkoutPrevisto = new Date('2026-09-20T17:00:00.000Z');
        const suitesPorReserva = {
            300: [
                {
                    id: 701,
                    status: StatusReservaSuite.CheckOutRealizado,
                    dataHoraCheckoutRealizado: checkoutManual,
                    idUsuarioCheckout: 5,
                },
                { id: 702, status: StatusReservaSuite.Hospedada },
                { id: 703, status: StatusReservaSuite.Hospedada },
            ],
        };

        const primeira = await executarComMocks({
            candidatas: [{ id: 300, idVendaJango: 56001, checkout: checkoutPrevisto }],
            suitesPorReserva,
        });

        assert.equal(primeira.resultado.checkoutExecutados, 1);
        assert.deepEqual(
            primeira.checkoutSuiteChamadas.map((c) => c.idReservaSuite),
            [702, 703]
        );
        assert.equal(
            suitesPorReserva[300][0].dataHoraCheckoutRealizado?.toISOString(),
            checkoutManual.toISOString()
        );
        assert.equal(suitesPorReserva[300][0].idUsuarioCheckout, 5);
        assert.equal(
            suitesPorReserva[300][1].status,
            StatusReservaSuite.CheckOutRealizado
        );
        assert.equal(
            suitesPorReserva[300][2].status,
            StatusReservaSuite.CheckOutRealizado
        );

        suitesPorReserva[300][1].status = StatusReservaSuite.CheckOutRealizado;
        suitesPorReserva[300][2].status = StatusReservaSuite.CheckOutRealizado;

        const segunda = await executarComMocks({
            candidatas: [{ id: 300, idVendaJango: 56001, checkout: checkoutPrevisto }],
            suitesPorReserva,
        });

        assert.equal(segunda.checkoutSuiteChamadas.length, 0);
        assert.equal(
            suitesPorReserva[300][0].dataHoraCheckoutRealizado?.toISOString(),
            checkoutManual.toISOString()
        );
        assert.equal(suitesPorReserva[300][0].idUsuarioCheckout, 5);
    });

    it('reserva sem linhas ReservaSuite — usa realizarCheckoutAdmin', async () => {
        const { resultado, checkoutAdminChamadas, checkoutSuiteChamadas } =
            await executarComMocks({
                candidatas: [{ id: 400, idVendaJango: 56002 }],
                suitesPorReserva: {
                    400: [],
                },
            });

        assert.equal(resultado.checkoutExecutados, 1);
        assert.equal(checkoutAdminChamadas, 1);
        assert.equal(checkoutSuiteChamadas.length, 0);
    });

    it('idempotência — segunda execução não duplica checkout', async () => {
        const suitesPorReserva = {
            200: [{ id: 801, status: StatusReservaSuite.Hospedada }],
        };

        const primeira = await executarComMocks({
            candidatas: [{ id: 200, idVendaJango: 56000 }],
            suitesPorReserva,
        });
        assert.equal(primeira.resultado.checkoutExecutados, 1);

        suitesPorReserva[200][0].status = StatusReservaSuite.CheckOutRealizado;

        const segunda = await executarComMocks({
            candidatas: [{ id: 200, idVendaJango: 56000 }],
            suitesPorReserva,
        });
        assert.equal(segunda.checkoutSuiteChamadas.length, 0);
    });

    it('sem candidatas — sempre consulta reservas elegíveis', async () => {
        let listarChamadas = 0;
        limparCacheModulos();
        process.env.HOSPEDIN_SYNC_USER_ID = '7';
        const { executarCheckoutAutomaticoDiario } = require(
            './hospedagemCheckoutAutomaticoService'
        );

        const resultado = await executarCheckoutAutomaticoDiario(AGORA, {
            resolverUsuario: async () => 7,
            listarCandidatas: async () => {
                listarChamadas += 1;
                return [];
            },
        });

        assert.equal(listarChamadas, 1);
        assert.equal(resultado.candidatas, 0);
        assert.equal(resultado.processadas, 0);
    });
});
