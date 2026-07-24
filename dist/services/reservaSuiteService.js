"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cancelarReservasExpiradas = cancelarReservasExpiradas;
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
const customError_1 = require("../utils/customError");
const hospedagemDescontoRecepcao_1 = require("../utils/hospedagemDescontoRecepcao");
const hospedagemPagamentoRecepcao_1 = require("../utils/hospedagemPagamentoRecepcao");
const reservaSuiteUtils_1 = require("../utils/reservaSuiteUtils");
const hospedagemConfirmacaoNotificacao_1 = require("./hospedagemConfirmacaoNotificacao");
const STATUS_RESERVA_SUITE_OCUPA = [
    ReservaSuite_1.StatusReservaSuite.AguardandoPagamento,
    ReservaSuite_1.StatusReservaSuite.Confirmada,
    ReservaSuite_1.StatusReservaSuite.Hospedada,
];
const MINUTOS_EXPIRACAO_RESERVA = 15;
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
        return (0, reservaSuiteUtils_1.intervalosConflitam)(intervalo, intervaloHospedagem(hospedagem));
    });
}
async function cancelarReservasExpiradas() {
    const limite = new Date(Date.now() - MINUTOS_EXPIRACAO_RESERVA * 60 * 1000);
    const hospedagens = await ReservaHospedagem_1.ReservaHospedagem.findAll({
        where: {
            status: ReservaHospedagem_1.StatusReservaHospedagem.AguardandoPagamento,
            createdAt: { [sequelize_1.Op.lt]: limite },
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
                    descricao: 'Reserva de hospedagem expirada por falta de pagamento (15 minutos).',
                }, { transaction: t });
            }
        });
        quantidade += 1;
    }
    return quantidade;
}
async function cancelarReservaHospedagem(idReservaHospedagem, idUsuario, descricaoHistorico = 'Reserva de hospedagem cancelada.') {
    const hospedagem = await ReservaHospedagem_1.ReservaHospedagem.findByPk(idReservaHospedagem, {
        include: [{ model: ReservaSuite_1.ReservaSuite, as: 'ReservaSuite' }],
    });
    if (!hospedagem) {
        throw new customError_1.CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }
    if (hospedagem.status === ReservaHospedagem_1.StatusReservaHospedagem.Cancelada) {
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
}
async function confirmarHospedagem(idTransacao) {
    const hospedagem = await ReservaHospedagem_1.ReservaHospedagem.findOne({
        where: { idTransacao },
        include: [{ model: ReservaSuite_1.ReservaSuite, as: 'ReservaSuite' }],
    });
    if (!hospedagem) {
        return;
    }
    if (hospedagem.status === ReservaHospedagem_1.StatusReservaHospedagem.Confirmada) {
        return;
    }
    if (hospedagem.status !== ReservaHospedagem_1.StatusReservaHospedagem.AguardandoPagamento) {
        return;
    }
    const dataConfirmacao = new Date();
    await database_1.default.transaction(async (t) => {
        await hospedagem.update({
            status: ReservaHospedagem_1.StatusReservaHospedagem.Confirmada,
            dataConfirmacao,
        }, { transaction: t });
        const suites = hospedagem.ReservaSuite ?? [];
        for (const suite of suites) {
            await suite.update({ status: ReservaSuite_1.StatusReservaSuite.Confirmada }, { transaction: t });
        }
        await Transacao_1.HistoricoTransacao.create({
            idTransacao,
            idUsuario: hospedagem.idUsuario,
            data: new Date(),
            descricao: 'Hospedagem confirmada após pagamento.',
        }, { transaction: t });
    });
    console.log('Hospedagem confirmada');
    try {
        await (0, hospedagemConfirmacaoNotificacao_1.notificarConfirmacaoHospedagem)(hospedagem.id, idTransacao);
    }
    catch (error) {
        console.error(`Erro ao notificar confirmação da hospedagem ${hospedagem.id}:`, error);
    }
}
async function suiteTemConflito(idEventoSuite, checkin, checkout, options) {
    const intervalo = { inicio: checkin, fim: checkout };
    const conflitos = await listarReservasSuiteConflitantes(idEventoSuite, intervalo, options);
    return conflitos.length > 0;
}
function validarSuitesSemDuplicata(suites) {
    const ids = suites.map((s) => s.idEventoSuite);
    if (new Set(ids).size !== ids.length) {
        throw new customError_1.CustomError('Não é permitido incluir a mesma suíte mais de uma vez no checkout.', 400, '');
    }
}
async function calcularCotacao(params) {
    const { idEventoSuite, checkin, checkout, adultos, criancas } = params;
    const suite = await EventoSuite_1.EventoSuite.findByPk(idEventoSuite);
    if (!suite) {
        throw new customError_1.CustomError('Suíte não encontrada.', 404, '');
    }
    if (!['Ativo', 'PDV'].includes(suite.status)) {
        throw new customError_1.CustomError('Suíte não disponível para venda.', 400, '');
    }
    const noites = (0, reservaSuiteUtils_1.calcularNoitesHotelaria)(checkin, checkout);
    (0, reservaSuiteUtils_1.calcularExtrasPousada)(adultos, criancas, suite.qtdeMinimaPessoas, suite.qtdeMaximaPessoas);
    const totais = (0, reservaSuiteUtils_1.calcularTotaisSuitePousada)(suite, adultos, criancas, noites);
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
        const conflito = await suiteTemConflito(suite.id, checkin, checkout);
        if (conflito) {
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
    const { idEvento, idUsuario, checkin, checkout, suites, origem = 'online', observacoes, idUsuarioOperador, pagamento = null, } = params;
    if (!suites?.length) {
        throw new customError_1.CustomError('Informe ao menos uma suíte no checkout.', 400, '');
    }
    validarSuitesSemDuplicata(suites);
    const isRecepcao = origem === 'recepcao';
    if (!isRecepcao && pagamento) {
        throw new customError_1.CustomError('Pagamento antecipado não permitido na reserva online.', 400, '');
    }
    // Reserva pública: janela oficial 16:00–19:00 / 08:00–13:00
    // Recepção: qualquer horário; se hoje, check-in deve ser > agora
    if (!isRecepcao) {
        (0, reservaSuiteUtils_1.validarHorarioCheckinHospedagem)(checkin);
        (0, reservaSuiteUtils_1.validarHorarioCheckoutHospedagem)(checkout);
    }
    (0, reservaSuiteUtils_1.validarCheckinPosteriorAoAgoraSeHoje)(checkin);
    const noites = (0, reservaSuiteUtils_1.calcularNoitesHotelaria)(checkin, checkout);
    const cotacoes = [];
    for (const item of suites) {
        const cotacao = await calcularCotacao({
            idEventoSuite: item.idEventoSuite,
            checkin,
            checkout,
            adultos: item.adultos,
            criancas: item.criancas,
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
    if (isRecepcao) {
        (0, hospedagemPagamentoRecepcao_1.validarPagamentoRecepcao)(totaisHospedagem.valorTotal, pagamento);
    }
    const valorPagoRecepcao = isRecepcao && pagamento ? (0, reservaSuiteUtils_1.roundMoney)(pagamento.valor) : 0;
    const saldoPendenteRecepcao = isRecepcao
        ? (0, hospedagemPagamentoRecepcao_1.calcularSaldoPendente)(totaisHospedagem.valorTotal, valorPagoRecepcao)
        : null;
    const quitada = isRecepcao &&
        (0, hospedagemPagamentoRecepcao_1.reservaQuitada)(totaisHospedagem.valorTotal, valorPagoRecepcao);
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
            valorPago: isRecepcao ? valorPagoRecepcao : 0,
            saldoPendente: isRecepcao
                ? saldoPendenteRecepcao
                : totaisHospedagem.valorTotal,
            formaPagamentoRecepcao: isRecepcao && valorPagoRecepcao > 0
                ? pagamento?.formaPagamento ?? null
                : null,
            observacaoPagamento: isRecepcao && pagamento?.observacao
                ? pagamento.observacao
                : null,
            comprovantePagamento: isRecepcao && pagamento?.comprovante
                ? pagamento.comprovante
                : null,
            origemReserva: isRecepcao ? 'ATENDENTE' : 'SITE',
            idUsuarioCriacao: isRecepcao
                ? idUsuarioOperador || null
                : null,
            status: isRecepcao
                ? ReservaHospedagem_1.StatusReservaHospedagem.Confirmada
                : ReservaHospedagem_1.StatusReservaHospedagem.AguardandoPagamento,
            dataConfirmacao: isRecepcao ? agora : null,
            observacoes: observacoes?.trim() || null,
            idTransacao: null,
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
                status: isRecepcao
                    ? ReservaSuite_1.StatusReservaSuite.Confirmada
                    : ReservaSuite_1.StatusReservaSuite.AguardandoPagamento,
            }, { transaction: t });
            for (const hospede of item.hospedes) {
                await ReservaHospede_1.ReservaHospede.create({
                    idReservaSuite: reservaItem.id,
                    nome: hospede.nome,
                    tipo: hospede.tipo,
                    dataNascimento: hospede.dataNascimento,
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
            status: isRecepcao
                ? quitada
                    ? 'Pago'
                    : 'Aguardando pagamento'
                : 'Aguardando pagamento',
            aceiteCompra: true,
            idEvento,
            ...(isRecepcao
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
        if (isRecepcao && valorPagoRecepcao > 0 && pagamento) {
            await PagamentoHospedagem_1.PagamentoHospedagem.create({
                idReservaHospedagem: hospedagem.id,
                valor: valorPagoRecepcao,
                dataPagamento: agora,
                formaPagamento: pagamento.formaPagamento,
                comprovante: pagamento.comprovante ?? null,
                observacao: pagamento.observacao ?? null,
                idUsuario: idUsuarioOperador || idUsuario,
            }, { transaction: t });
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
        let descricaoHistorico = isRecepcao
            ? 'Reserva criada pela recepção.'
            : 'Transação criada para hospedagem com múltiplas suítes (checkout pousada).';
        if (isRecepcao && linhasDescontoHistorico.length > 0) {
            descricaoHistorico += `\n\nDesconto aplicado:\n${linhasDescontoHistorico.join('\n')}`;
        }
        if (isRecepcao) {
            descricaoHistorico += `\n\nValor total:\n${(0, hospedagemPagamentoRecepcao_1.formatarMoedaHistorico)(totaisHospedagem.valorTotal)}\n\nPagamento recebido:\n${(0, hospedagemPagamentoRecepcao_1.formatarMoedaHistorico)(valorPagoRecepcao)}\n\nSaldo pendente:\n${(0, hospedagemPagamentoRecepcao_1.formatarMoedaHistorico)(saldoPendenteRecepcao ?? 0)}`;
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
    if (isRecepcao && resultado.hospedagem.idTransacao) {
        try {
            await (0, hospedagemConfirmacaoNotificacao_1.notificarConfirmacaoHospedagem)(resultado.hospedagem.id, resultado.hospedagem.idTransacao);
        }
        catch (error) {
            console.error(`Erro ao notificar reserva recepção ${resultado.hospedagem.id}:`, error);
        }
    }
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
function parseSuitesCheckout(body) {
    const suites = body?.suites;
    if (!Array.isArray(suites) || suites.length === 0) {
        throw new customError_1.CustomError('suites deve ser um array com ao menos um item.', 400, '');
    }
    return suites.map((s, index) => {
        const idEventoSuite = (0, reservaSuiteUtils_1.parsePositiveInt)(s.idEventoSuite, `suites[${index}].idEventoSuite`, 1);
        const adultos = (0, reservaSuiteUtils_1.parsePositiveInt)(s.adultos, `suites[${index}].adultos`, 1);
        const criancas = (0, reservaSuiteUtils_1.parsePositiveInt)(s.criancas ?? 0, `suites[${index}].criancas`, 0);
        const hospedes = parseHospedesSuite(s, index, adultos, criancas);
        const desconto = (0, hospedagemDescontoRecepcao_1.parseDescontoRecepcao)(s?.desconto, index);
        return { idEventoSuite, adultos, criancas, hospedes, desconto };
    });
}
function parseHospedesSuite(suite, index, adultos, criancas) {
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
        if (!nome) {
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
