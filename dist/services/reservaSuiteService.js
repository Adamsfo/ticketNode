"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MINUTOS_EXPIRACAO_LINK_PAGAMENTO = void 0;
exports.gerarTokenPagamentoReserva = gerarTokenPagamentoReserva;
exports.cancelarReservasExpiradas = cancelarReservasExpiradas;
exports.assertTransacaoHospedagemPagaivel = assertTransacaoHospedagemPagaivel;
exports.cancelarReservaHospedagem = cancelarReservaHospedagem;
exports.confirmarHospedagem = confirmarHospedagem;
exports.suiteTemConflito = suiteTemConflito;
exports.calcularCotacao = calcularCotacao;
exports.listarSuitesDisponiveis = listarSuitesDisponiveis;
exports.checkoutHospedagem = checkoutHospedagem;
exports.parseParamsDisponibilidade = parseParamsDisponibilidade;
exports.parseParamsCotacao = parseParamsCotacao;
exports.parseSuitesCheckout = parseSuitesCheckout;
exports.obterResumoPagamentoPorTransacao = obterResumoPagamentoPorTransacao;
exports.obterReservaConfirmadaPorTransacao = obterReservaConfirmadaPorTransacao;
exports.obterReservaPublicaPorToken = obterReservaPublicaPorToken;
exports.autenticarReservaPublicaPorToken = autenticarReservaPublicaPorToken;
const crypto_1 = require("crypto");
const sequelize_1 = require("sequelize");
const database_1 = __importDefault(require("../database"));
const Evento_1 = require("../models/Evento");
const EventoSuite_1 = require("../models/EventoSuite");
const ReservaSuite_1 = require("../models/ReservaSuite");
const ReservaHospedagem_1 = require("../models/ReservaHospedagem");
const ReservaHospede_1 = require("../models/ReservaHospede");
const Transacao_1 = require("../models/Transacao");
const CupomPromocional_1 = require("../models/CupomPromocional");
const PagamentoHospedagem_1 = require("../models/PagamentoHospedagem");
const Usuario_1 = require("../models/Usuario");
const customError_1 = require("../utils/customError");
const jwtUtils_1 = require("../utils/jwtUtils");
const hospedagemDescontoRecepcao_1 = require("../utils/hospedagemDescontoRecepcao");
const hospedagemPagamentoRecepcao_1 = require("../utils/hospedagemPagamentoRecepcao");
const reservaSuiteUtils_1 = require("../utils/reservaSuiteUtils");
const suiteDisponibilidadeService_1 = require("./suiteDisponibilidadeService");
const hospedagemConfirmacaoNotificacao_1 = require("./hospedagemConfirmacaoNotificacao");
const reservaObservacoesUtils_1 = require("../utils/reservaObservacoesUtils");
const STATUS_RESERVA_SUITE_OCUPA = [
    ReservaSuite_1.StatusReservaSuite.AguardandoPagamento,
    ReservaSuite_1.StatusReservaSuite.Confirmada,
    ReservaSuite_1.StatusReservaSuite.Hospedada,
];
/** Expiração legada do checkout online (CLIENTE/SITE) quando expiraEm está nulo. */
const MINUTOS_EXPIRACAO_RESERVA = 15;
/** Link externo /reserva/:token (recepção → enviar para cliente). */
exports.MINUTOS_EXPIRACAO_LINK_PAGAMENTO = 30;
/** Origens de reserva feitas pelo cliente (online) — compatível com produção (CLIENTE) e legado (SITE). */
const ORIGENS_RESERVA_CLIENTE_ONLINE = ['CLIENTE', 'SITE'];
function minutosParaLimite(minutos) {
    return new Date(Date.now() - minutos * 60 * 1000);
}
function calcularExpiraEmLinkPagamento(desde = new Date()) {
    return new Date(desde.getTime() + exports.MINUTOS_EXPIRACAO_LINK_PAGAMENTO * 60 * 1000);
}
async function marcarReservaComoExpirada(hospedagem, descricaoHistorico) {
    if (hospedagem.status !== ReservaHospedagem_1.StatusReservaHospedagem.AguardandoPagamento) {
        return;
    }
    const idReserva = hospedagem.id;
    const enviarEmailExpiracao = Boolean(hospedagem.tokenPagamento);
    await database_1.default.transaction(async (t) => {
        await hospedagem.update({ status: ReservaHospedagem_1.StatusReservaHospedagem.Expirada }, { transaction: t });
        const suites = hospedagem.ReservaSuite ?? [];
        for (const suite of suites) {
            await suite.update({ status: ReservaSuite_1.StatusReservaSuite.Expirada }, { transaction: t });
        }
        if (hospedagem.idTransacao) {
            await Transacao_1.HistoricoTransacao.create({
                idTransacao: hospedagem.idTransacao,
                idUsuario: hospedagem.idUsuario,
                data: new Date(),
                descricao: descricaoHistorico,
            }, { transaction: t });
        }
    });
    if (enviarEmailExpiracao) {
        try {
            await (0, hospedagemConfirmacaoNotificacao_1.notificarExpiracaoHospedagem)(idReserva);
        }
        catch (error) {
            console.error(`Erro ao enviar e-mail de expiração da reserva ${idReserva}:`, error);
        }
    }
}
/** Gera token opaco para link /reserva/TOKEN. */
function gerarTokenPagamentoReserva() {
    return (0, crypto_1.randomBytes)(32).toString('hex');
}
const IDADE_MAXIMA_CRIANCA_HOSPEDAGEM = 12;
/** Idade em anos civis completos (considera dia, mês e ano). */
function calcularIdadeEmAnos(dataNascimento, referencia = new Date()) {
    const nasc = new Date(dataNascimento.getFullYear(), dataNascimento.getMonth(), dataNascimento.getDate());
    const ref = new Date(referencia.getFullYear(), referencia.getMonth(), referencia.getDate());
    let idade = ref.getFullYear() - nasc.getFullYear();
    const mes = ref.getMonth() - nasc.getMonth();
    if (mes < 0 || (mes === 0 && ref.getDate() < nasc.getDate())) {
        idade -= 1;
    }
    return idade;
}
function intervaloHospedagem(h) {
    return {
        inicio: new Date(h.checkin),
        fim: new Date(h.checkout),
    };
}
async function listarReservasSuiteConflitantes(idEventoSuite, intervalo, options) {
    const reservas = await ReservaSuite_1.ReservaSuite.findAll({
        where: {
            idEventoSuite,
            status: { [sequelize_1.Op.in]: STATUS_RESERVA_SUITE_OCUPA },
        },
        include: [
            {
                model: ReservaHospedagem_1.ReservaHospedagem,
                as: 'ReservaHospedagem',
                required: true,
            },
        ],
    });
    const excludeSuiteIds = new Set(options?.excludeReservaSuiteIds ?? []);
    return reservas.filter((reserva) => {
        if (excludeSuiteIds.has(reserva.id)) {
            return false;
        }
        if (options?.excludeReservaHospedagemId &&
            reserva.idReservaHospedagem === options.excludeReservaHospedagemId) {
            return false;
        }
        const hospedagem = reserva.ReservaHospedagem;
        if (!hospedagem) {
            return false;
        }
        return (0, reservaSuiteUtils_1.periodosHospedagemConflitam)(intervalo, intervaloHospedagem(hospedagem));
    });
}
async function cancelarReservasExpiradas() {
    const agora = new Date();
    const limiteLegacy = minutosParaLimite(MINUTOS_EXPIRACAO_RESERVA);
    const limiteLink = minutosParaLimite(exports.MINUTOS_EXPIRACAO_LINK_PAGAMENTO);
    // 1) expiraEm preenchido → usa a data
    // 2) nulo + CLIENTE/SITE → legado 15 min
    // 3) nulo + link externo (tokenPagamento) → 30 min a partir de createdAt
    const hospedagens = await ReservaHospedagem_1.ReservaHospedagem.findAll({
        where: {
            status: ReservaHospedagem_1.StatusReservaHospedagem.AguardandoPagamento,
            [sequelize_1.Op.or]: [
                { expiraEm: { [sequelize_1.Op.lt]: agora } },
                {
                    expiraEm: null,
                    origemReserva: { [sequelize_1.Op.in]: [...ORIGENS_RESERVA_CLIENTE_ONLINE] },
                    createdAt: { [sequelize_1.Op.lt]: limiteLegacy },
                },
                {
                    expiraEm: null,
                    tokenPagamento: { [sequelize_1.Op.ne]: null },
                    createdAt: { [sequelize_1.Op.lt]: limiteLink },
                },
            ],
        },
        include: [
            {
                model: ReservaSuite_1.ReservaSuite,
                as: 'ReservaSuite',
            },
        ],
    });
    let quantidade = 0;
    for (const hospedagem of hospedagens) {
        const temLink = Boolean(hospedagem.tokenPagamento);
        const minutos = temLink
            ? exports.MINUTOS_EXPIRACAO_LINK_PAGAMENTO
            : MINUTOS_EXPIRACAO_RESERVA;
        await marcarReservaComoExpirada(hospedagem, `Reserva de hospedagem expirada por falta de pagamento (${minutos} minutos).`);
        quantidade += 1;
    }
    if (quantidade > 0) {
        const { incrementarHospedagemRefreshVersion } = await Promise.resolve().then(() => __importStar(require('./hospedagemRefreshVersionService')));
        await incrementarHospedagemRefreshVersion();
    }
    return quantidade;
}
/**
 * Bloqueia início de pagamento (PIX/MP) se a Transacao for de reserva
 * via link externo já expirada. Ingressos (sem ReservaHospedagem) → no-op.
 */
async function assertTransacaoHospedagemPagaivel(idTransacao) {
    const id = Number(idTransacao);
    if (!(id > 0))
        return;
    await cancelarReservasExpiradas();
    const hospedagem = await ReservaHospedagem_1.ReservaHospedagem.findOne({
        where: { idTransacao: id },
        include: [{ model: ReservaSuite_1.ReservaSuite, as: 'ReservaSuite' }],
    });
    if (!hospedagem)
        return;
    // Só o link externo (/reserva/:token) entra nesta regra de expiração do link.
    if (!hospedagem.tokenPagamento)
        return;
    if (hospedagem.status === ReservaHospedagem_1.StatusReservaHospedagem.Expirada) {
        throw new customError_1.CustomError('Reserva expirada.', 400, '');
    }
    if (hospedagem.status !== ReservaHospedagem_1.StatusReservaHospedagem.AguardandoPagamento) {
        throw new customError_1.CustomError('Reserva expirada.', 400, '');
    }
    const createdAt = new Date(hospedagem.createdAt ||
        hospedagem.expiraEm ||
        0);
    const limite = hospedagem.expiraEm != null
        ? new Date(hospedagem.expiraEm)
        : calcularExpiraEmLinkPagamento(createdAt);
    if (Date.now() >= limite.getTime()) {
        await marcarReservaComoExpirada(hospedagem, `Reserva de hospedagem expirada por falta de pagamento (${exports.MINUTOS_EXPIRACAO_LINK_PAGAMENTO} minutos).`);
        throw new customError_1.CustomError('Reserva expirada.', 400, '');
    }
}
async function cancelarReservaHospedagem(idReservaHospedagem, idUsuario, descricaoHistorico = 'Reserva de hospedagem cancelada.') {
    const hospedagem = await ReservaHospedagem_1.ReservaHospedagem.findByPk(idReservaHospedagem, {
        include: [{ model: ReservaSuite_1.ReservaSuite, as: 'ReservaSuite' }],
    });
    if (!hospedagem) {
        throw new customError_1.CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }
    if (hospedagem.status === ReservaHospedagem_1.StatusReservaHospedagem.Cancelada) {
        const { markOutboundCancelled } = await Promise.resolve().then(() => __importStar(require('../integrations/hospedin/outbound/HospedinOutboundEnqueueService')));
        await markOutboundCancelled(hospedagem.id);
        return;
    }
    await database_1.default.transaction(async (t) => {
        await hospedagem.update({ status: ReservaHospedagem_1.StatusReservaHospedagem.Cancelada }, { transaction: t });
        const suites = hospedagem.ReservaSuite ?? [];
        for (const suite of suites) {
            await suite.update({ status: ReservaSuite_1.StatusReservaSuite.Cancelada }, { transaction: t });
        }
        if (hospedagem.idTransacao) {
            await Transacao_1.HistoricoTransacao.create({
                idTransacao: hospedagem.idTransacao,
                idUsuario,
                data: new Date(),
                descricao: descricaoHistorico,
            }, { transaction: t });
        }
    });
    const { incrementarHospedagemRefreshVersion } = await Promise.resolve().then(() => __importStar(require('./hospedagemRefreshVersionService')));
    await incrementarHospedagemRefreshVersion();
    const { markOutboundCancelled } = await Promise.resolve().then(() => __importStar(require('../integrations/hospedin/outbound/HospedinOutboundEnqueueService')));
    await markOutboundCancelled(hospedagem.id);
}
/** Mapeia tipo/gateway da Transacao para a forma usada no financeiro da recepção. */
function mapearFormaPagamentoHospedagemExterno(tipoPagamento, gatewayPagamento) {
    const tipo = String(tipoPagamento || '').toLowerCase();
    if (tipo.includes('pix'))
        return PagamentoHospedagem_1.FormaPagamentoRecepcaoValor.PIX;
    if (tipo.includes('débito') || tipo.includes('debito')) {
        return PagamentoHospedagem_1.FormaPagamentoRecepcaoValor.CartaoDebito;
    }
    if (tipo.includes('crédito') || tipo.includes('credito')) {
        return PagamentoHospedagem_1.FormaPagamentoRecepcaoValor.CartaoCredito;
    }
    if (tipo.includes('dinheiro'))
        return PagamentoHospedagem_1.FormaPagamentoRecepcaoValor.Dinheiro;
    const gateway = String(gatewayPagamento || '').toLowerCase();
    if (gateway.includes('mercado') || gateway.includes('mp')) {
        return PagamentoHospedagem_1.FormaPagamentoRecepcaoValor.PIX;
    }
    return PagamentoHospedagem_1.FormaPagamentoRecepcaoValor.Outro;
}
function resolverFormaPagamentoRecepcao(forma) {
    if ((0, hospedagemPagamentoRecepcao_1.isFormaPagamentoRecepcao)(forma)) {
        return forma;
    }
    return PagamentoHospedagem_1.FormaPagamentoRecepcaoValor.Outro;
}
/**
 * Confirma hospedagem após pagamento aprovado (webhook/PIX/cartão).
 * Para reservas da recepção (ATENDENTE / link ao cliente), quita o financeiro
 * nos mesmos campos do pagamento interno — sem alterar fluxo de ingressos.
 */
async function confirmarHospedagem(idTransacao) {
    const hospedagem = await ReservaHospedagem_1.ReservaHospedagem.findOne({
        where: { idTransacao },
        include: [{ model: ReservaSuite_1.ReservaSuite, as: 'ReservaSuite' }],
    });
    if (!hospedagem) {
        return;
    }
    const valorTotal = (0, reservaSuiteUtils_1.roundMoney)((0, reservaSuiteUtils_1.toNumber)(hospedagem.valorTotal));
    const valorPagoAtual = (0, reservaSuiteUtils_1.roundMoney)((0, reservaSuiteUtils_1.toNumber)(hospedagem.valorPago ?? 0));
    const saldoAtual = hospedagem.saldoPendente != null
        ? (0, reservaSuiteUtils_1.roundMoney)((0, reservaSuiteUtils_1.toNumber)(hospedagem.saldoPendente))
        : (0, hospedagemPagamentoRecepcao_1.calcularSaldoPendente)(valorTotal, valorPagoAtual);
    const jaQuitada = (0, hospedagemPagamentoRecepcao_1.reservaQuitada)(valorTotal, valorPagoAtual) && saldoAtual <= 0.009;
    if (hospedagem.status === ReservaHospedagem_1.StatusReservaHospedagem.Confirmada &&
        jaQuitada) {
        return;
    }
    if (hospedagem.status !== ReservaHospedagem_1.StatusReservaHospedagem.AguardandoPagamento &&
        hospedagem.status !== ReservaHospedagem_1.StatusReservaHospedagem.Confirmada) {
        return;
    }
    // Financeiro da recepção/link: mesmos campos do pagamento administrativo.
    // Reservas CLIENTE/SITE online mantêm só a confirmação de status (fluxo existente).
    const sincronizarFinanceiroRecepcao = hospedagem.origemReserva === 'ATENDENTE' ||
        Boolean(hospedagem.tokenPagamento);
    const transacao = await Transacao_1.Transacao.findByPk(idTransacao);
    const dataConfirmacao = hospedagem.dataConfirmacao ?? new Date();
    let valorPago = valorPagoAtual;
    let saldoPendente = saldoAtual;
    let formaPagamentoRecepcao = (0, hospedagemPagamentoRecepcao_1.isFormaPagamentoRecepcao)(hospedagem.formaPagamentoRecepcao)
        ? hospedagem.formaPagamentoRecepcao
        : null;
    let comprovantePagamento = hospedagem.comprovantePagamento ?? null;
    let observacaoPagamento = hospedagem.observacaoPagamento ?? null;
    if (sincronizarFinanceiroRecepcao) {
        valorPago = (0, reservaSuiteUtils_1.roundMoney)((0, reservaSuiteUtils_1.toNumber)(transacao?.valorRecebido ?? 0));
        if (valorPago <= 0) {
            valorPago = (0, reservaSuiteUtils_1.roundMoney)((0, reservaSuiteUtils_1.toNumber)(transacao?.valorTotal ?? valorTotal));
        }
        if (valorPago > valorTotal) {
            valorPago = valorTotal;
        }
        saldoPendente = (0, hospedagemPagamentoRecepcao_1.calcularSaldoPendente)(valorTotal, valorPago);
        formaPagamentoRecepcao = mapearFormaPagamentoHospedagemExterno(transacao?.tipoPagamento, transacao?.gatewayPagamento);
        if (!observacaoPagamento) {
            observacaoPagamento =
                'Pagamento confirmado pelo cliente (gateway).';
        }
        // comprovante: gateway normalmente não envia arquivo; preserva se já houver
        comprovantePagamento = hospedagem.comprovantePagamento ?? null;
    }
    const formaPagamentoRegistro = resolverFormaPagamentoRecepcao(formaPagamentoRecepcao);
    const precisavaConfirmarStatus = hospedagem.status === ReservaHospedagem_1.StatusReservaHospedagem.AguardandoPagamento;
    await database_1.default.transaction(async (t) => {
        await hospedagem.update({
            status: ReservaHospedagem_1.StatusReservaHospedagem.Confirmada,
            dataConfirmacao,
            ...(sincronizarFinanceiroRecepcao
                ? {
                    valorPago,
                    saldoPendente,
                    formaPagamentoRecepcao,
                    comprovantePagamento,
                    observacaoPagamento,
                }
                : {}),
        }, { transaction: t });
        const suites = hospedagem.ReservaSuite ?? [];
        for (const suite of suites) {
            if (suite.status !== ReservaSuite_1.StatusReservaSuite.Confirmada) {
                await suite.update({ status: ReservaSuite_1.StatusReservaSuite.Confirmada }, { transaction: t });
            }
        }
        if (sincronizarFinanceiroRecepcao && valorPago > 0) {
            const qtdPagamentos = await PagamentoHospedagem_1.PagamentoHospedagem.count({
                where: { idReservaHospedagem: hospedagem.id },
                transaction: t,
            });
            if (qtdPagamentos === 0) {
                await PagamentoHospedagem_1.PagamentoHospedagem.create({
                    idReservaHospedagem: hospedagem.id,
                    valor: valorPago,
                    dataPagamento: transacao?.dataPagamento ?? dataConfirmacao,
                    formaPagamento: formaPagamentoRegistro,
                    comprovante: comprovantePagamento,
                    observacao: observacaoPagamento,
                    idUsuario: hospedagem.idUsuario,
                }, { transaction: t });
            }
        }
        await Transacao_1.HistoricoTransacao.create({
            idTransacao,
            idUsuario: hospedagem.idUsuario,
            data: new Date(),
            descricao: sincronizarFinanceiroRecepcao
                ? `Hospedagem confirmada após pagamento. Valor pago: ${(0, hospedagemPagamentoRecepcao_1.formatarMoedaHistorico)(valorPago)}. Saldo pendente: ${(0, hospedagemPagamentoRecepcao_1.formatarMoedaHistorico)(saldoPendente)}.`
                : 'Hospedagem confirmada após pagamento.',
        }, { transaction: t });
    });
    const { incrementarHospedagemRefreshVersion } = await Promise.resolve().then(() => __importStar(require('./hospedagemRefreshVersionService')));
    await incrementarHospedagemRefreshVersion();
    const { hospedinOutboundEnqueueService } = await Promise.resolve().then(() => __importStar(require('../integrations/hospedin/outbound/HospedinOutboundEnqueueService')));
    await hospedinOutboundEnqueueService.markDirty(hospedagem.id);
    console.log('Hospedagem confirmada', {
        idReserva: hospedagem.id,
        idTransacao,
        sincronizarFinanceiroRecepcao,
        valorPago,
        saldoPendente,
    });
    // Notifica só na primeira confirmação de status (evita reenvio em reparo financeiro)
    if (precisavaConfirmarStatus) {
        try {
            await (0, hospedagemConfirmacaoNotificacao_1.notificarConfirmacaoHospedagem)(hospedagem.id, idTransacao);
        }
        catch (error) {
            console.error(`Erro ao notificar confirmação da hospedagem ${hospedagem.id}:`, error);
        }
    }
}
async function suiteTemConflito(idEventoSuite, checkin, checkout, options) {
    const intervalo = { inicio: checkin, fim: checkout };
    const conflitos = await listarReservasSuiteConflitantes(idEventoSuite, intervalo, options);
    return conflitos.length > 0;
}
/**
 * Carrega ocupantes da suíte no formato do SuiteDisponibilidadeService.
 */
async function carregarReservasParaDisponibilidade(idEventoSuite, options) {
    const excludeSuiteIds = new Set(options?.excludeReservaSuiteIds ?? []);
    const ocupantes = await ReservaSuite_1.ReservaSuite.findAll({
        where: {
            idEventoSuite,
            status: { [sequelize_1.Op.in]: STATUS_RESERVA_SUITE_OCUPA },
        },
        include: [
            {
                model: ReservaHospedagem_1.ReservaHospedagem,
                as: 'ReservaHospedagem',
                required: true,
            },
        ],
    });
    const out = [];
    for (const reserva of ocupantes) {
        if (excludeSuiteIds.has(reserva.id))
            continue;
        if (options?.excludeReservaHospedagemId &&
            reserva.idReservaHospedagem === options.excludeReservaHospedagemId) {
            continue;
        }
        const hospedagem = reserva.ReservaHospedagem;
        if (!hospedagem)
            continue;
        out.push({
            id: hospedagem.id,
            status: hospedagem.status,
            checkin: hospedagem.checkin,
            checkout: hospedagem.checkout,
            dataHoraCheckinReal: hospedagem.dataHoraCheckinReal ?? null,
            dataHoraCheckoutRealizado: hospedagem.dataHoraCheckoutRealizado ?? null,
            saldoPendente: (0, reservaSuiteUtils_1.toNumber)(hospedagem
                .saldoPendente ?? 0),
        });
    }
    return out;
}
function validarSuitesSemDuplicata(suites) {
    const ids = suites.map((s) => s.idEventoSuite);
    if (new Set(ids).size !== ids.length) {
        throw new customError_1.CustomError('Não é permitido incluir a mesma suíte mais de uma vez no checkout.', 400, '');
    }
}
async function calcularCotacao(params) {
    const { idEventoSuite, checkin, checkout, adultos, criancas, validarCapacidadeHospedes = true, } = params;
    const suite = await EventoSuite_1.EventoSuite.findByPk(idEventoSuite);
    if (!suite) {
        throw new customError_1.CustomError('Suíte não encontrada.', 404, '');
    }
    if (!['Ativo', 'PDV'].includes(suite.status)) {
        throw new customError_1.CustomError('Suíte não disponível para venda.', 400, '');
    }
    const noites = (0, reservaSuiteUtils_1.calcularNoitesHotelaria)(checkin, checkout);
    if (validarCapacidadeHospedes) {
        (0, reservaSuiteUtils_1.calcularExtrasPousada)(adultos, criancas, suite.qtdeMinimaPessoas, suite.qtdeMaximaPessoas);
    }
    let totais = (0, reservaSuiteUtils_1.calcularTotaisSuitePousada)(suite, adultos, criancas, noites);
    if (!totais && !validarCapacidadeHospedes && noites >= 1) {
        // Fora da capacidade: preço base da suíte sem adicionais (não bloqueia).
        const min = suite.qtdeMinimaPessoas ?? 1;
        const max = suite.qtdeMaximaPessoas ?? min;
        const precoDiaria = (0, reservaSuiteUtils_1.toNumber)(suite.preco);
        const taxaDiaria = (0, reservaSuiteUtils_1.toNumber)(suite.taxaServico);
        const valorDiaria = (0, reservaSuiteUtils_1.toNumber)(suite.valor);
        const suitePreco = (0, reservaSuiteUtils_1.roundMoney)(precoDiaria * noites);
        const suiteTaxa = (0, reservaSuiteUtils_1.roundMoney)(taxaDiaria * noites);
        const suiteValor = (0, reservaSuiteUtils_1.roundMoney)(valorDiaria * noites);
        totais = {
            min,
            max,
            total: adultos + criancas,
            adultosIncluidos: Math.min(adultos, min),
            criancasIncluidas: 0,
            adultosExtras: 0,
            criancasExtras: 0,
            valorAdultoExtra: 150,
            valorCriancaExtra: 120,
            precoDiaria,
            taxaDiaria,
            valorDiaria,
            suitePreco,
            suiteTaxa,
            suiteValor,
            extraAdultoValor: 0,
            extraCriancaValor: 0,
            precoTotal: suitePreco,
            taxaServicoTotal: suiteTaxa,
            valorTotal: (0, reservaSuiteUtils_1.roundMoney)(suitePreco + suiteTaxa),
            temExtras: false,
        };
    }
    if (!totais) {
        throw new customError_1.CustomError('Não foi possível calcular a cotação da suíte.', 400, '');
    }
    const adicionalAdultos = {
        qtde: totais.adultosExtras,
        encontrado: totais.adultosExtras > 0,
        precoUnitario: totais.valorAdultoExtra,
        taxaUnitaria: 0,
        valorUnitario: totais.valorAdultoExtra,
        preco: totais.extraAdultoValor,
        taxaServico: 0,
        valor: totais.extraAdultoValor,
    };
    const adicionalCriancas = {
        qtde: totais.criancasExtras,
        encontrado: totais.criancasExtras > 0,
        precoUnitario: totais.valorCriancaExtra,
        taxaUnitaria: 0,
        valorUnitario: totais.valorCriancaExtra,
        preco: totais.extraCriancaValor,
        taxaServico: 0,
        valor: totais.extraCriancaValor,
    };
    return {
        idEvento: suite.idEvento,
        idEventoSuite: suite.id,
        suite: {
            nome: suite.nome,
            descricao: suite.descricao,
            qtdeMinimaPessoas: suite.qtdeMinimaPessoas,
            qtdeMaximaPessoas: suite.qtdeMaximaPessoas,
            diarias: {
                preco: totais.precoDiaria,
                taxaServico: totais.taxaDiaria,
                valor: totais.valorDiaria,
            },
            totais: {
                preco: totais.suitePreco,
                taxaServico: totais.suiteTaxa,
                valor: totais.suiteValor,
            },
            regras: {
                incluiAte: totais.min,
                valorAdultoExtra: totais.valorAdultoExtra,
                valorCriancaExtra: totais.valorCriancaExtra,
            },
        },
        checkin,
        checkout,
        adultos,
        criancas,
        noites,
        adicionais: {
            adultos: adicionalAdultos,
            criancas: adicionalCriancas,
        },
        totais: {
            preco: totais.precoTotal,
            taxaServico: totais.taxaServicoTotal,
            valorTotal: totais.valorTotal,
        },
    };
}
async function listarSuitesDisponiveis(params) {
    await cancelarReservasExpiradas();
    const { idEvento, checkin, checkout } = params;
    const noites = (0, reservaSuiteUtils_1.calcularNoitesHotelaria)(checkin, checkout);
    const suites = await EventoSuite_1.EventoSuite.findAll({
        where: {
            idEvento,
            status: 'Ativo',
        },
    });
    const disponiveis = [];
    for (const suite of suites) {
        // Parte 4: decisão exclusiva do SuiteDisponibilidadeService (matriz §4).
        const reservas = await carregarReservasParaDisponibilidade(suite.id);
        const disp = (0, suiteDisponibilidadeService_1.calcularDisponibilidadePeriodo)({
            idEventoSuite: suite.id,
            checkin,
            checkout,
            reservas,
        });
        if (!disp.podeReservar) {
            continue;
        }
        const min = suite.qtdeMinimaPessoas ?? 1;
        const totaisBase = (0, reservaSuiteUtils_1.calcularTotaisSuitePousada)(suite, min, 0, noites);
        if (!totaisBase) {
            continue;
        }
        disponiveis.push({
            ...suite.get({ plain: true }),
            noites,
            podeReservar: true,
            cotacao: {
                preco: totaisBase.precoTotal,
                taxaServico: totaisBase.taxaServicoTotal,
                valorTotal: totaisBase.valorTotal,
            },
        });
    }
    return {
        idEvento,
        checkin,
        checkout,
        noites,
        suites: disponiveis,
    };
}
async function checkoutHospedagem(params) {
    const { idEvento, idUsuario, checkin, checkout, suites, origem = 'online', enviarParaCliente = false, observacoes, idUsuarioOperador, pagamento = null, } = params;
    if (!suites?.length) {
        throw new customError_1.CustomError('Informe ao menos uma suíte no checkout.', 400, '');
    }
    validarSuitesSemDuplicata(suites);
    const isIntegracao = origem === 'integracao';
    const isRecepcao = origem === 'recepcao' || isIntegracao;
    const isLinkCliente = origem === 'recepcao' && !!enviarParaCliente;
    /** Confirma na hora (recepção tradicional / integração). Link ao cliente NÃO confirma. */
    const confirmaImediatamente = isRecepcao && !isLinkCliente;
    if (!isRecepcao && pagamento) {
        throw new customError_1.CustomError('Pagamento antecipado não permitido na reserva online.', 400, '');
    }
    if (isLinkCliente && pagamento) {
        throw new customError_1.CustomError('Pagamento antecipado não permitido ao enviar a reserva para o cliente finalizar.', 400, '');
    }
    // Site (origem online): janela oficial, data e capacidade.
    // Recepção / Hospedin / internos: não aplicam essas validações.
    const isReservaSite = origem === 'online';
    if (isReservaSite) {
        (0, reservaSuiteUtils_1.validarHorarioCheckinHospedagem)(checkin);
        (0, reservaSuiteUtils_1.validarHorarioCheckoutHospedagem)(checkout);
        (0, reservaSuiteUtils_1.validarCheckinNaoEmDataPassada)(checkin);
        (0, reservaSuiteUtils_1.validarCheckinPosteriorAoAgoraSeHoje)(checkin);
    }
    const noites = (0, reservaSuiteUtils_1.calcularNoitesHotelaria)(checkin, checkout);
    const cotacoes = [];
    for (const item of suites) {
        const cotacao = await calcularCotacao({
            idEventoSuite: item.idEventoSuite,
            checkin,
            checkout,
            adultos: item.adultos,
            criancas: item.criancas,
            validarCapacidadeHospedes: isReservaSite,
        });
        if (cotacao.idEvento !== idEvento) {
            throw new customError_1.CustomError(`Suíte ${item.idEventoSuite} não pertence ao evento informado.`, 400, '');
        }
        const conflito = await suiteTemConflito(item.idEventoSuite, checkin, checkout);
        if (conflito) {
            throw new customError_1.CustomError(`Suíte indisponível no período: ${cotacao.suite.nome}.`, 409, '');
        }
        cotacoes.push({ item, cotacao });
    }
    if (!isRecepcao) {
        for (const { item } of cotacoes) {
            if (item.desconto) {
                throw new customError_1.CustomError('Desconto manual não permitido na reserva online.', 400, '');
            }
        }
    }
    const suitesComTotais = cotacoes.map(({ item, cotacao }) => {
        const precoOriginal = (0, reservaSuiteUtils_1.roundMoney)(cotacao.totais.preco);
        const taxaOriginal = (0, reservaSuiteUtils_1.roundMoney)(cotacao.totais.taxaServico);
        const valorOriginalTotal = (0, reservaSuiteUtils_1.roundMoney)(cotacao.totais.valorTotal);
        if (isRecepcao && item.desconto) {
            (0, hospedagemDescontoRecepcao_1.validarDescontoRecepcao)(valorOriginalTotal, item.desconto);
            const valorFinalDesconto = (0, hospedagemDescontoRecepcao_1.calcularValorFinalComDesconto)(valorOriginalTotal, item.desconto);
            const repartido = (0, hospedagemDescontoRecepcao_1.aplicarDescontoProporcional)(precoOriginal, taxaOriginal, valorFinalDesconto);
            return {
                item,
                cotacao,
                preco: repartido.preco,
                taxaServico: repartido.taxaServico,
                valorTotal: repartido.valorTotal,
                valorOriginal: valorOriginalTotal,
                descontoTipo: item.desconto.tipo,
                descontoValor: item.desconto.valor,
                valorFinal: repartido.valorTotal,
            };
        }
        return {
            item,
            cotacao,
            preco: precoOriginal,
            taxaServico: taxaOriginal,
            valorTotal: valorOriginalTotal,
            valorOriginal: null,
            descontoTipo: null,
            descontoValor: null,
            valorFinal: null,
        };
    });
    const totaisHospedagem = suitesComTotais.reduce((acc, suite) => ({
        preco: (0, reservaSuiteUtils_1.roundMoney)(acc.preco + suite.preco),
        taxaServico: (0, reservaSuiteUtils_1.roundMoney)(acc.taxaServico + suite.taxaServico),
        valorTotal: (0, reservaSuiteUtils_1.roundMoney)(acc.valorTotal + suite.valorTotal),
    }), { preco: 0, taxaServico: 0, valorTotal: 0 });
    if (confirmaImediatamente) {
        (0, hospedagemPagamentoRecepcao_1.validarPagamentoRecepcao)(totaisHospedagem.valorTotal, pagamento);
    }
    const valorPagoRecepcao = confirmaImediatamente && pagamento ? (0, reservaSuiteUtils_1.roundMoney)(pagamento.valor) : 0;
    const saldoPendenteRecepcao = confirmaImediatamente
        ? (0, hospedagemPagamentoRecepcao_1.calcularSaldoPendente)(totaisHospedagem.valorTotal, valorPagoRecepcao)
        : isLinkCliente
            ? totaisHospedagem.valorTotal
            : null;
    const quitada = confirmaImediatamente &&
        (0, hospedagemPagamentoRecepcao_1.reservaQuitada)(totaisHospedagem.valorTotal, valorPagoRecepcao);
    const tokenPagamento = isLinkCliente ? gerarTokenPagamentoReserva() : null;
    let idPagamentoAntecipadoCriado = null;
    const mapTipoPagamentoTransacao = (forma) => {
        switch (forma) {
            case 'PIX':
                return Transacao_1.TipoPagamento.Pix;
            case 'Dinheiro':
                return Transacao_1.TipoPagamento.Dinheiro;
            case 'CartaoCredito':
                return Transacao_1.TipoPagamento.Credito;
            case 'CartaoDebito':
                return Transacao_1.TipoPagamento.Debito;
            default:
                return Transacao_1.TipoPagamento.Dinheiro;
        }
    };
    const agora = new Date();
    const resultado = await database_1.default.transaction(async (t) => {
        const hospedagem = await ReservaHospedagem_1.ReservaHospedagem.create({
            idEvento,
            idUsuario,
            checkin,
            checkout,
            noites,
            preco: totaisHospedagem.preco,
            taxaServico: totaisHospedagem.taxaServico,
            valorTotal: totaisHospedagem.valorTotal,
            valorPago: confirmaImediatamente ? valorPagoRecepcao : 0,
            saldoPendente: confirmaImediatamente
                ? saldoPendenteRecepcao
                : totaisHospedagem.valorTotal,
            formaPagamentoRecepcao: confirmaImediatamente && valorPagoRecepcao > 0
                ? pagamento?.formaPagamento ?? null
                : null,
            observacaoPagamento: confirmaImediatamente && pagamento?.observacao
                ? pagamento.observacao
                : null,
            comprovantePagamento: confirmaImediatamente && pagamento?.comprovante
                ? pagamento.comprovante
                : null,
            // Produção: CLIENTE (online), ATENDENTE (recepção), HOSPEDIN (integração).
            origemReserva: isIntegracao
                ? 'HOSPEDIN'
                : isRecepcao
                    ? 'ATENDENTE'
                    : 'CLIENTE',
            idUsuarioCriacao: isRecepcao
                ? idUsuarioOperador || null
                : null,
            status: confirmaImediatamente
                ? ReservaHospedagem_1.StatusReservaHospedagem.Confirmada
                : ReservaHospedagem_1.StatusReservaHospedagem.AguardandoPagamento,
            dataConfirmacao: confirmaImediatamente ? agora : null,
            ...(0, reservaObservacoesUtils_1.buildObservacoesFieldsForCreate)({
                origemIntegracao: isIntegracao,
                observacoes,
            }),
            idTransacao: null,
            tokenPagamento,
            // Link externo: expira 30 min após a criação (createdAt / agora).
            expiraEm: isLinkCliente
                ? calcularExpiraEmLinkPagamento(agora)
                : null,
            linkPagamentoEnviadoEm: null,
        }, { transaction: t });
        const itens = [];
        for (const suite of suitesComTotais) {
            const { item, cotacao } = suite;
            const reservaItem = await ReservaSuite_1.ReservaSuite.create({
                idReservaHospedagem: hospedagem.id,
                idEventoSuite: item.idEventoSuite,
                adultos: item.adultos,
                criancas: item.criancas,
                preco: suite.preco,
                taxaServico: suite.taxaServico,
                valorTotal: suite.valorTotal,
                valorOriginal: suite.valorOriginal,
                descontoTipo: suite.descontoTipo,
                descontoValor: suite.descontoValor,
                valorFinal: suite.valorFinal,
                status: confirmaImediatamente
                    ? ReservaSuite_1.StatusReservaSuite.Confirmada
                    : ReservaSuite_1.StatusReservaSuite.AguardandoPagamento,
            }, { transaction: t });
            for (const hospede of item.hospedes) {
                await ReservaHospede_1.ReservaHospede.create({
                    idReservaSuite: reservaItem.id,
                    nome: hospede.nome,
                    tipo: hospede.tipo,
                    dataNascimento: hospede.dataNascimento,
                    ...(hospede.idUsuario != null
                        ? { idUsuario: Number(hospede.idUsuario) }
                        : {}),
                }, { transaction: t });
            }
            itens.push(reservaItem);
        }
        const dataTransacao = agora;
        const transacao = await Transacao_1.Transacao.create({
            idUsuario,
            dataTransacao,
            preco: totaisHospedagem.preco,
            taxaServico: totaisHospedagem.taxaServico,
            valorTotal: totaisHospedagem.valorTotal,
            status: confirmaImediatamente
                ? quitada
                    ? 'Pago'
                    : 'Aguardando pagamento'
                : 'Aguardando pagamento',
            aceiteCompra: true,
            idEvento,
            origemTransacao: Transacao_1.OrigemTransacao.HOSPEDAGEM,
            ...(confirmaImediatamente
                ? {
                    dataPagamento: valorPagoRecepcao > 0 ? agora : undefined,
                    tipoPagamento: mapTipoPagamentoTransacao(pagamento?.formaPagamento),
                    valorRecebido: valorPagoRecepcao,
                }
                : {}),
        }, { transaction: t });
        for (const suite of suitesComTotais) {
            const { item, cotacao } = suite;
            const precoOriginalTransacao = (0, reservaSuiteUtils_1.roundMoney)(cotacao.totais.preco);
            const valorDescontoTransacao = suite.valorOriginal != null
                ? (0, reservaSuiteUtils_1.roundMoney)(suite.valorOriginal - suite.valorTotal)
                : 0;
            await Transacao_1.EventoSuiteTransacao.create({
                idTransacao: transacao.id,
                idEventoSuite: item.idEventoSuite,
                precoOriginal: precoOriginalTransacao,
                preco: suite.preco,
                taxaServico: suite.taxaServico,
                valorTotal: suite.valorTotal,
                taxaServicoOriginal: (0, reservaSuiteUtils_1.roundMoney)(cotacao.totais.taxaServico),
                ...(valorDescontoTransacao > 0
                    ? {
                        tipoDesconto: suite.descontoTipo === 'PERCENTUAL'
                            ? CupomPromocional_1.TipoDesconto.Percentual
                            : CupomPromocional_1.TipoDesconto.Fixo,
                        valorDesconto: suite.descontoValor,
                        precoDesconto: suite.preco,
                    }
                    : {}),
            }, { transaction: t });
        }
        if (confirmaImediatamente && valorPagoRecepcao > 0 && pagamento) {
            const pagCriado = await PagamentoHospedagem_1.PagamentoHospedagem.create({
                idReservaHospedagem: hospedagem.id,
                valor: valorPagoRecepcao,
                dataPagamento: agora,
                formaPagamento: pagamento.formaPagamento,
                comprovante: pagamento.comprovante ?? null,
                observacao: pagamento.observacao ?? null,
                idUsuario: idUsuarioOperador || idUsuario,
            }, { transaction: t });
            if (pagamento.formaPagamento === 'Antecipado') {
                idPagamentoAntecipadoCriado = Number(pagCriado.id);
            }
        }
        const linhasDescontoHistorico = suitesComTotais
            .filter((s) => s.descontoTipo && s.descontoValor)
            .map((s) => {
            const nome = s.cotacao.suite.nome ?? `Suíte ${s.item.idEventoSuite}`;
            return `${nome}: ${(0, hospedagemDescontoRecepcao_1.formatarDescontoHistorico)({
                tipo: s.descontoTipo,
                valor: s.descontoValor,
            })}`;
        });
        let descricaoHistorico = isLinkCliente
            ? 'Reserva criada pela recepção — aguardando pagamento do cliente (link).'
            : isRecepcao
                ? 'Reserva criada pela recepção.'
                : 'Transação criada para hospedagem com múltiplas suítes (checkout pousada).';
        if (isRecepcao && linhasDescontoHistorico.length > 0) {
            descricaoHistorico += `\n\nDesconto aplicado:\n${linhasDescontoHistorico.join('\n')}`;
        }
        if (confirmaImediatamente) {
            descricaoHistorico += `\n\nValor total:\n${(0, hospedagemPagamentoRecepcao_1.formatarMoedaHistorico)(totaisHospedagem.valorTotal)}\n\nPagamento recebido:\n${(0, hospedagemPagamentoRecepcao_1.formatarMoedaHistorico)(valorPagoRecepcao)}\n\nSaldo pendente:\n${(0, hospedagemPagamentoRecepcao_1.formatarMoedaHistorico)(saldoPendenteRecepcao ?? 0)}`;
        }
        if (isLinkCliente && tokenPagamento) {
            descricaoHistorico += `\n\nLink de pagamento gerado:\n${(0, hospedagemConfirmacaoNotificacao_1.montarUrlPublicaReserva)(tokenPagamento)}`;
        }
        await Transacao_1.HistoricoTransacao.create({
            idTransacao: transacao.id,
            idUsuario: isRecepcao
                ? idUsuarioOperador || idUsuario
                : idUsuario,
            data: dataTransacao,
            descricao: descricaoHistorico,
        }, { transaction: t });
        hospedagem.idTransacao = transacao.id;
        await hospedagem.save({ transaction: t });
        return {
            hospedagem,
            itens,
            cotacoes: cotacoes.map((c) => c.cotacao),
            transacao,
        };
    });
    if (idPagamentoAntecipadoCriado &&
        pagamento?.formaPagamento === 'Antecipado' &&
        valorPagoRecepcao > 0) {
        const { lancarAntecipadoNoCaixaLegado } = await Promise.resolve().then(() => __importStar(require('./hospedagemPagamentoService')));
        await lancarAntecipadoNoCaixaLegado(valorPagoRecepcao, idPagamentoAntecipadoCriado);
    }
    if (confirmaImediatamente && resultado.hospedagem.idTransacao) {
        try {
            await (0, hospedagemConfirmacaoNotificacao_1.notificarConfirmacaoHospedagem)(resultado.hospedagem.id, resultado.hospedagem.idTransacao);
        }
        catch (error) {
            console.error(`Erro ao notificar reserva recepção ${resultado.hospedagem.id}:`, error);
        }
    }
    if (isLinkCliente && resultado.hospedagem.idTransacao) {
        try {
            await (0, hospedagemConfirmacaoNotificacao_1.notificarLinkPagamentoHospedagem)(resultado.hospedagem.id);
        }
        catch (error) {
            console.error(`Erro ao enviar link de pagamento da reserva ${resultado.hospedagem.id}:`, error);
        }
    }
    const { incrementarHospedagemRefreshVersion } = await Promise.resolve().then(() => __importStar(require('./hospedagemRefreshVersionService')));
    await incrementarHospedagemRefreshVersion();
    const { hospedinOutboundEnqueueService } = await Promise.resolve().then(() => __importStar(require('../integrations/hospedin/outbound/HospedinOutboundEnqueueService')));
    await hospedinOutboundEnqueueService.markDirty(resultado.hospedagem.id);
    return resultado;
}
function parseParamsDisponibilidade(query) {
    return {
        idEvento: (0, reservaSuiteUtils_1.parsePositiveInt)(query.idEvento, 'idEvento', 1),
        checkin: (0, reservaSuiteUtils_1.parseDateTimeParam)(query.checkin, 'checkin'),
        checkout: (0, reservaSuiteUtils_1.parseDateTimeParam)(query.checkout, 'checkout'),
    };
}
function parseParamsCotacao(query) {
    return {
        idEventoSuite: (0, reservaSuiteUtils_1.parsePositiveInt)(query.idEventoSuite, 'idEventoSuite', 1),
        checkin: (0, reservaSuiteUtils_1.parseDateTimeParam)(query.checkin, 'checkin'),
        checkout: (0, reservaSuiteUtils_1.parseDateTimeParam)(query.checkout, 'checkout'),
        adultos: (0, reservaSuiteUtils_1.parsePositiveInt)(query.adultos, 'adultos', 1),
        criancas: (0, reservaSuiteUtils_1.parsePositiveInt)(query.criancas ?? 0, 'criancas', 0),
    };
}
function parseSuitesCheckout(body, options) {
    const suites = body?.suites;
    if (!Array.isArray(suites) || suites.length === 0) {
        throw new customError_1.CustomError('suites deve ser um array com ao menos um item.', 400, '');
    }
    const nomeOpcional = options?.nomeOpcional === true;
    return suites.map((s, index) => {
        const idEventoSuite = (0, reservaSuiteUtils_1.parsePositiveInt)(s.idEventoSuite, `suites[${index}].idEventoSuite`, 1);
        const adultos = (0, reservaSuiteUtils_1.parsePositiveInt)(s.adultos, `suites[${index}].adultos`, 1);
        const criancas = (0, reservaSuiteUtils_1.parsePositiveInt)(s.criancas ?? 0, `suites[${index}].criancas`, 0);
        const hospedes = parseHospedesSuite(s, index, adultos, criancas, nomeOpcional);
        const desconto = (0, hospedagemDescontoRecepcao_1.parseDescontoRecepcao)(s?.desconto, index);
        return { idEventoSuite, adultos, criancas, hospedes, desconto };
    });
}
function parseHospedesSuite(suite, index, adultos, criancas, nomeOpcional = false) {
    const hospedes = suite?.hospedes;
    if (!Array.isArray(hospedes)) {
        throw new customError_1.CustomError(`suites[${index}].hospedes é obrigatório.`, 400, '');
    }
    const totalEsperado = adultos + criancas;
    if (hospedes.length !== totalEsperado) {
        throw new customError_1.CustomError(`suites[${index}].hospedes deve conter ${totalEsperado} hóspede(s).`, 400, '');
    }
    let adultosInformados = 0;
    let criancasInformadas = 0;
    const parsed = [];
    for (let hospedeIndex = 0; hospedeIndex < hospedes.length; hospedeIndex += 1) {
        const hospede = hospedes[hospedeIndex];
        const nome = String(hospede?.nome ?? '').trim();
        if (!nome && !nomeOpcional) {
            throw new customError_1.CustomError(`suites[${index}].hospedes[${hospedeIndex}].nome é obrigatório.`, 400, '');
        }
        const tipo = hospede?.tipo;
        if (tipo !== ReservaHospede_1.TipoReservaHospede.Adulto && tipo !== ReservaHospede_1.TipoReservaHospede.Crianca) {
            throw new customError_1.CustomError(`suites[${index}].hospedes[${hospedeIndex}].tipo inválido.`, 400, '');
        }
        if (tipo === ReservaHospede_1.TipoReservaHospede.Adulto) {
            adultosInformados += 1;
            parsed.push({
                nome,
                tipo,
                dataNascimento: null,
            });
            continue;
        }
        criancasInformadas += 1;
        if (!hospede?.dataNascimento) {
            throw new customError_1.CustomError(`suites[${index}].hospedes[${hospedeIndex}].dataNascimento é obrigatório para crianças.`, 400, '');
        }
        const dataNascimento = new Date(hospede.dataNascimento);
        if (Number.isNaN(dataNascimento.getTime())) {
            throw new customError_1.CustomError(`suites[${index}].hospedes[${hospedeIndex}].dataNascimento inválida.`, 400, '');
        }
        const idade = calcularIdadeEmAnos(dataNascimento);
        if (idade > IDADE_MAXIMA_CRIANCA_HOSPEDAGEM) {
            throw new customError_1.CustomError(`O hóspede "${nome}" tem ${idade} anos. A categoria Criança é válida somente até ${IDADE_MAXIMA_CRIANCA_HOSPEDAGEM} anos. Para hóspedes acima de ${IDADE_MAXIMA_CRIANCA_HOSPEDAGEM} anos, cadastre como Adulto.`, 400, '');
        }
        parsed.push({
            nome,
            tipo,
            dataNascimento,
        });
    }
    if (adultosInformados !== adultos) {
        throw new customError_1.CustomError(`suites[${index}].hospedes deve conter ${adultos} adulto(s).`, 400, '');
    }
    if (criancasInformadas !== criancas) {
        throw new customError_1.CustomError(`suites[${index}].hospedes deve conter ${criancas} criança(s).`, 400, '');
    }
    return parsed;
}
async function obterResumoPagamentoPorTransacao(idTransacao) {
    const hospedagem = await ReservaHospedagem_1.ReservaHospedagem.findOne({
        where: { idTransacao },
        include: [
            {
                model: ReservaSuite_1.ReservaSuite,
                as: 'ReservaSuite',
                include: [
                    {
                        model: EventoSuite_1.EventoSuite,
                        as: 'EventoSuite',
                        attributes: ['nome'],
                    },
                ],
            },
        ],
    });
    if (!hospedagem) {
        return null;
    }
    const suites = hospedagem.ReservaSuite ?? [];
    return {
        checkin: hospedagem.checkin,
        checkout: hospedagem.checkout,
        noites: hospedagem.noites,
        suites: suites.map((item) => ({
            nomeSuite: item.EventoSuite?.nome ?? `Suíte ${item.idEventoSuite}`,
            adultos: item.adultos,
            criancas: item.criancas,
            subtotal: (0, reservaSuiteUtils_1.toNumber)(item.preco),
        })),
        subtotalGeral: (0, reservaSuiteUtils_1.toNumber)(hospedagem.preco),
        taxaServico: (0, reservaSuiteUtils_1.toNumber)(hospedagem.taxaServico),
        valorTotal: (0, reservaSuiteUtils_1.toNumber)(hospedagem.valorTotal),
    };
}
async function obterReservaConfirmadaPorTransacao(idTransacao, idUsuario) {
    const hospedagem = await ReservaHospedagem_1.ReservaHospedagem.findOne({
        where: { idTransacao, idUsuario },
        include: [
            {
                model: Evento_1.Evento,
                as: 'Evento',
                attributes: ['id', 'nome', 'imagem'],
            },
            {
                model: ReservaSuite_1.ReservaSuite,
                as: 'ReservaSuite',
                include: [
                    {
                        model: EventoSuite_1.EventoSuite,
                        as: 'EventoSuite',
                        attributes: ['nome'],
                    },
                    {
                        model: ReservaHospede_1.ReservaHospede,
                        as: 'ReservaHospede',
                        attributes: ['nome', 'tipo', 'dataNascimento'],
                    },
                ],
            },
        ],
    });
    if (!hospedagem) {
        return null;
    }
    const evento = hospedagem.Evento;
    const suites = hospedagem.ReservaSuite ?? [];
    return {
        reserva: {
            id: hospedagem.id,
            status: hospedagem.status,
            checkin: hospedagem.checkin,
            checkout: hospedagem.checkout,
            noites: hospedagem.noites,
            preco: (0, reservaSuiteUtils_1.toNumber)(hospedagem.preco),
            taxaServico: (0, reservaSuiteUtils_1.toNumber)(hospedagem.taxaServico),
            valorTotal: (0, reservaSuiteUtils_1.toNumber)(hospedagem.valorTotal),
            dataConfirmacao: hospedagem.dataConfirmacao ?? null,
        },
        evento: {
            id: evento?.id ?? hospedagem.idEvento,
            nome: evento?.nome ?? 'Pousada',
            imagem: evento?.imagem ?? null,
        },
        suites: suites.map((item) => ({
            idReservaSuite: item.id,
            nome: item.EventoSuite?.nome ?? `Suíte ${item.idEventoSuite}`,
            adultos: item.adultos,
            criancas: item.criancas,
            preco: (0, reservaSuiteUtils_1.toNumber)(item.preco),
            taxaServico: (0, reservaSuiteUtils_1.toNumber)(item.taxaServico),
            valorTotal: (0, reservaSuiteUtils_1.toNumber)(item.valorTotal),
            hospedes: (item.ReservaHospede ?? []).map((hospede) => ({
                nome: hospede.nome,
                tipo: hospede.tipo,
                dataNascimento: hospede.dataNascimento
                    ? String(hospede.dataNascimento)
                    : null,
            })),
        })),
    };
}
/** Consulta pública da reserva pelo token do link (sem autenticação). */
async function obterReservaPublicaPorToken(token) {
    const tokenLimpo = String(token || '').trim();
    if (!tokenLimpo || tokenLimpo.length < 16) {
        throw new customError_1.CustomError('Token inválido.', 400, '');
    }
    // Expira imediatamente se já passou o prazo (antes de montar a tela).
    await cancelarReservasExpiradas();
    const hospedagem = await ReservaHospedagem_1.ReservaHospedagem.findOne({
        where: { tokenPagamento: tokenLimpo },
        include: [
            {
                model: Usuario_1.Usuario,
                as: 'Usuario',
                attributes: ['id', 'nomeCompleto', 'sobreNome', 'email', 'telefone'],
                required: false,
            },
            {
                model: Evento_1.Evento,
                as: 'Evento',
                attributes: ['id', 'nome', 'imagem'],
                required: false,
            },
            {
                model: Transacao_1.Transacao,
                as: 'Transacao',
                attributes: [
                    'id',
                    'status',
                    'preco',
                    'taxaServico',
                    'valorTotal',
                    'valorRecebido',
                ],
                required: false,
            },
            {
                model: ReservaSuite_1.ReservaSuite,
                as: 'ReservaSuite',
                include: [
                    {
                        model: EventoSuite_1.EventoSuite,
                        as: 'EventoSuite',
                        attributes: ['nome'],
                    },
                ],
            },
        ],
    });
    if (!hospedagem) {
        throw new customError_1.CustomError('Reserva não encontrada.', 404, '');
    }
    // Garantia pontual: link vencido por createdAt/expiraEm mesmo se o job ainda não rodou.
    if (hospedagem.status === ReservaHospedagem_1.StatusReservaHospedagem.AguardandoPagamento &&
        hospedagem.tokenPagamento) {
        const createdAt = new Date(hospedagem.createdAt ||
            Date.now());
        const limite = hospedagem.expiraEm != null
            ? new Date(hospedagem.expiraEm)
            : calcularExpiraEmLinkPagamento(createdAt);
        if (Date.now() >= limite.getTime()) {
            await marcarReservaComoExpirada(hospedagem, `Reserva de hospedagem expirada por falta de pagamento (${exports.MINUTOS_EXPIRACAO_LINK_PAGAMENTO} minutos).`);
            hospedagem.status = ReservaHospedagem_1.StatusReservaHospedagem.Expirada;
        }
    }
    const usuario = hospedagem
        .Usuario;
    const evento = hospedagem
        .Evento;
    const transacao = hospedagem.Transacao;
    const suites = hospedagem.ReservaSuite ?? [];
    const totalAdultos = suites.reduce((s, i) => s + (i.adultos || 0), 0);
    const totalCriancas = suites.reduce((s, i) => s + (i.criancas || 0), 0);
    const nomeCliente = [usuario?.nomeCompleto, usuario?.sobreNome]
        .map((p) => String(p || '').trim())
        .filter(Boolean)
        .join(' ')
        .trim();
    const expirada = hospedagem.status === ReservaHospedagem_1.StatusReservaHospedagem.Expirada;
    const podePagar = !expirada &&
        hospedagem.status === ReservaHospedagem_1.StatusReservaHospedagem.AguardandoPagamento &&
        !!hospedagem.idTransacao &&
        transacao?.status !== 'Pago';
    return {
        origemPagamento: 'HOSPEDAGEM',
        idReserva: hospedagem.id,
        status: hospedagem.status,
        expirada,
        mensagemExpiracao: expirada
            ? 'Esta reserva expirou por falta de pagamento.\n\nA suíte já foi liberada para novas reservas.\n\nCaso ainda tenha interesse, faça uma nova reserva.'
            : null,
        podePagar,
        expiraEm: hospedagem.expiraEm ?? null,
        cliente: {
            nome: nomeCliente || usuario?.nomeCompleto || 'Cliente',
            idUsuario: Number(hospedagem.idUsuario) || null,
        },
        evento: {
            id: evento?.id ?? hospedagem.idEvento,
            nome: evento?.nome ?? 'Pousada',
            imagem: evento?.imagem ?? null,
        },
        periodo: {
            checkin: hospedagem.checkin,
            checkout: hospedagem.checkout,
            noites: hospedagem.noites,
        },
        hospedes: {
            adultos: totalAdultos,
            criancas: totalCriancas,
        },
        suites: suites.map((suite) => ({
            nome: suite.EventoSuite?.nome ?? `Suíte ${suite.idEventoSuite}`,
            adultos: suite.adultos,
            criancas: suite.criancas,
            preco: (0, reservaSuiteUtils_1.toNumber)(suite.preco),
            taxaServico: (0, reservaSuiteUtils_1.toNumber)(suite.taxaServico),
            valorTotal: (0, reservaSuiteUtils_1.toNumber)(suite.valorTotal),
        })),
        valores: {
            preco: (0, reservaSuiteUtils_1.toNumber)(hospedagem.preco),
            taxaServico: (0, reservaSuiteUtils_1.toNumber)(hospedagem.taxaServico),
            valorTotal: (0, reservaSuiteUtils_1.toNumber)(hospedagem.valorTotal),
        },
        pagamento: {
            idTransacao: hospedagem.idTransacao,
            idEvento: hospedagem.idEvento,
            tipoCompra: 'hospedagem',
            statusTransacao: transacao?.status ?? null,
            registroTransacao: transacao
                ? {
                    id: transacao.id,
                    status: transacao.status,
                    preco: (0, reservaSuiteUtils_1.toNumber)(transacao.preco),
                    taxaServico: (0, reservaSuiteUtils_1.toNumber)(transacao.taxaServico),
                    valorTotal: (0, reservaSuiteUtils_1.toNumber)(transacao.valorTotal),
                    valorRecebido: (0, reservaSuiteUtils_1.toNumber)(transacao.valorRecebido ?? 0),
                    idEvento: hospedagem.idEvento,
                }
                : null,
        },
    };
}
/** Magic login: token do link → JWT do Usuario da reserva (mesmo contrato do /login). */
async function autenticarReservaPublicaPorToken(token) {
    const tokenLimpo = String(token || '').trim();
    if (!tokenLimpo || tokenLimpo.length < 16) {
        throw new customError_1.CustomError('Token inválido.', 400, '');
    }
    await cancelarReservasExpiradas();
    const hospedagem = await ReservaHospedagem_1.ReservaHospedagem.findOne({
        where: { tokenPagamento: tokenLimpo },
        include: [
            {
                model: Transacao_1.Transacao,
                as: 'Transacao',
                attributes: ['id', 'status'],
                required: false,
            },
        ],
    });
    if (!hospedagem) {
        throw new customError_1.CustomError('Reserva não encontrada.', 404, '');
    }
    if (hospedagem.status === ReservaHospedagem_1.StatusReservaHospedagem.AguardandoPagamento &&
        hospedagem.tokenPagamento) {
        const createdAt = new Date(hospedagem.createdAt ||
            Date.now());
        const limite = hospedagem.expiraEm != null
            ? new Date(hospedagem.expiraEm)
            : calcularExpiraEmLinkPagamento(createdAt);
        if (Date.now() >= limite.getTime()) {
            await marcarReservaComoExpirada(hospedagem, `Reserva de hospedagem expirada por falta de pagamento (${exports.MINUTOS_EXPIRACAO_LINK_PAGAMENTO} minutos).`);
            throw new customError_1.CustomError('Reserva expirada.', 400, '');
        }
    }
    if (hospedagem.status === ReservaHospedagem_1.StatusReservaHospedagem.Expirada) {
        throw new customError_1.CustomError('Reserva expirada.', 400, '');
    }
    if (hospedagem.status !== ReservaHospedagem_1.StatusReservaHospedagem.AguardandoPagamento) {
        throw new customError_1.CustomError('Esta reserva não está disponível para pagamento.', 400, '');
    }
    const transacao = hospedagem.Transacao;
    if (!hospedagem.idTransacao) {
        throw new customError_1.CustomError('Transação da reserva não encontrada.', 400, '');
    }
    if (transacao?.status === 'Pago') {
        throw new customError_1.CustomError('Esta reserva já foi paga.', 400, '');
    }
    const idUsuario = Number(hospedagem.idUsuario);
    if (!Number.isFinite(idUsuario) || idUsuario <= 0) {
        throw new customError_1.CustomError('Usuário da reserva não encontrado.', 400, '');
    }
    const usuario = await Usuario_1.Usuario.findByPk(idUsuario);
    if (!usuario) {
        throw new customError_1.CustomError('Usuário não encontrado.', 404, '');
    }
    if (!usuario.ativo) {
        throw new customError_1.CustomError('Conta não ativada.', 403, '');
    }
    const email = String(usuario.email || '').trim();
    if (!email || !email.includes('@')) {
        throw new customError_1.CustomError('E-mail do cliente inválido para pagamento.', 400, '');
    }
    const jwt = (0, jwtUtils_1.generateToken)(usuario);
    usuario.token = jwt;
    await usuario.save();
    return jwt;
}
