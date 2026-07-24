import { Op, Transaction } from 'sequelize';
import connection from '../database';
import { Evento } from '../models/Evento';
import { EventoSuite } from '../models/EventoSuite';
import { ReservaSuite, StatusReservaSuite } from '../models/ReservaSuite';
import {
    ReservaHospedagem,
    StatusReservaHospedagem,
} from '../models/ReservaHospedagem';
import { ReservaHospede, TipoReservaHospede } from '../models/ReservaHospede';
import { Transacao, EventoSuiteTransacao, HistoricoTransacao, TipoPagamento } from '../models/Transacao';
import { TipoDesconto } from '../models/CupomPromocional';
import { PagamentoHospedagem } from '../models/PagamentoHospedagem';
import { CustomError } from '../utils/customError';
import {
    aplicarDescontoProporcional,
    calcularValorFinalComDesconto,
    DescontoRecepcaoInput,
    formatarDescontoHistorico,
    parseDescontoRecepcao,
    validarDescontoRecepcao,
} from '../utils/hospedagemDescontoRecepcao';
import {
    calcularSaldoPendente,
    formatarMoedaHistorico,
    PagamentoRecepcaoInput,
    reservaQuitada,
    validarPagamentoRecepcao,
} from '../utils/hospedagemPagamentoRecepcao';
import {
    calcularExtrasPousada,
    calcularNoitesHotelaria,
    calcularTotaisSuitePousada,
    intervalosConflitam,
    parseDateTimeParam,
    parsePositiveInt,
    roundMoney,
    toNumber,
    validarHorarioCheckinHospedagem,
    validarHorarioCheckoutHospedagem,
    validarCheckinPosteriorAoAgoraSeHoje,
    type IntervaloDateTime,
} from '../utils/reservaSuiteUtils';
import { notificarConfirmacaoHospedagem } from './hospedagemConfirmacaoNotificacao';

const STATUS_RESERVA_SUITE_OCUPA = [
    StatusReservaSuite.AguardandoPagamento,
    StatusReservaSuite.Confirmada,
    StatusReservaSuite.Hospedada,
];

const MINUTOS_EXPIRACAO_RESERVA = 15;
const IDADE_MAXIMA_CRIANCA_HOSPEDAGEM = 12;

/** Idade em anos civis completos (considera dia, mês e ano). */
function calcularIdadeEmAnos(
    dataNascimento: Date,
    referencia: Date = new Date()
): number {
    const nasc = new Date(
        dataNascimento.getFullYear(),
        dataNascimento.getMonth(),
        dataNascimento.getDate()
    );
    const ref = new Date(
        referencia.getFullYear(),
        referencia.getMonth(),
        referencia.getDate()
    );

    let idade = ref.getFullYear() - nasc.getFullYear();
    const mes = ref.getMonth() - nasc.getMonth();
    if (mes < 0 || (mes === 0 && ref.getDate() < nasc.getDate())) {
        idade -= 1;
    }
    return idade;
}

export type HospedeCheckoutItem = {
    nome: string;
    tipo: TipoReservaHospede;
    dataNascimento: Date | null;
};

export type SuiteCheckoutItem = {
    idEventoSuite: number;
    adultos: number;
    criancas: number;
    hospedes: HospedeCheckoutItem[];
    /** Exclusivo recepção — rejeitado no checkout online */
    desconto?: DescontoRecepcaoInput | null;
};

function intervaloHospedagem(h: ReservaHospedagem): IntervaloDateTime {
    return {
        inicio: new Date(h.checkin),
        fim: new Date(h.checkout),
    };
}

async function listarReservasSuiteConflitantes(
    idEventoSuite: number,
    intervalo: IntervaloDateTime,
    options?: {
        excludeReservaHospedagemId?: number;
        excludeReservaSuiteIds?: number[];
    }
): Promise<ReservaSuite[]> {
    const reservas = await ReservaSuite.findAll({
        where: {
            idEventoSuite,
            status: { [Op.in]: STATUS_RESERVA_SUITE_OCUPA },
        },
        include: [
            {
                model: ReservaHospedagem,
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

        if (
            options?.excludeReservaHospedagemId &&
            reserva.idReservaHospedagem === options.excludeReservaHospedagemId
        ) {
            return false;
        }

        const hospedagem = (reserva as ReservaSuite & {
            ReservaHospedagem?: ReservaHospedagem;
        }).ReservaHospedagem;

        if (!hospedagem) {
            return false;
        }

        return intervalosConflitam(intervalo, intervaloHospedagem(hospedagem));
    });
}

export async function cancelarReservasExpiradas(): Promise<number> {
    const limite = new Date(Date.now() - MINUTOS_EXPIRACAO_RESERVA * 60 * 1000);

    const hospedagens = await ReservaHospedagem.findAll({
        where: {
            status: StatusReservaHospedagem.AguardandoPagamento,
            createdAt: { [Op.lt]: limite },
        } as Record<string, unknown>,
        include: [
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
            },
        ],
    });

    let quantidade = 0;

    for (const hospedagem of hospedagens) {
        await connection.transaction(async (t: Transaction) => {
            await hospedagem.update(
                { status: StatusReservaHospedagem.Expirada },
                { transaction: t }
            );

            const suites = (hospedagem as ReservaHospedagem & {
                ReservaSuite?: ReservaSuite[];
            }).ReservaSuite ?? [];

            for (const suite of suites) {
                await suite.update(
                    { status: StatusReservaSuite.Expirada },
                    { transaction: t }
                );
            }

            if (hospedagem.idTransacao) {
                await HistoricoTransacao.create(
                    {
                        idTransacao: hospedagem.idTransacao,
                        idUsuario: hospedagem.idUsuario,
                        data: new Date(),
                        descricao:
                            'Reserva de hospedagem expirada por falta de pagamento (15 minutos).',
                    },
                    { transaction: t }
                );
            }
        });

        quantidade += 1;
    }

    return quantidade;
}

export async function cancelarReservaHospedagem(
    idReservaHospedagem: number,
    idUsuario: number,
    descricaoHistorico = 'Reserva de hospedagem cancelada.'
): Promise<void> {
    const hospedagem = await ReservaHospedagem.findByPk(idReservaHospedagem, {
        include: [{ model: ReservaSuite, as: 'ReservaSuite' }],
    });

    if (!hospedagem) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    if (hospedagem.status === StatusReservaHospedagem.Cancelada) {
        return;
    }

    await connection.transaction(async (t: Transaction) => {
        await hospedagem.update(
            { status: StatusReservaHospedagem.Cancelada },
            { transaction: t }
        );

        const suites = (hospedagem as ReservaHospedagem & {
            ReservaSuite?: ReservaSuite[];
        }).ReservaSuite ?? [];

        for (const suite of suites) {
            await suite.update(
                { status: StatusReservaSuite.Cancelada },
                { transaction: t }
            );
        }

        if (hospedagem.idTransacao) {
            await HistoricoTransacao.create(
                {
                    idTransacao: hospedagem.idTransacao,
                    idUsuario,
                    data: new Date(),
                    descricao: descricaoHistorico,
                },
                { transaction: t }
            );
        }
    });
}

export async function confirmarHospedagem(idTransacao: number): Promise<void> {
    const hospedagem = await ReservaHospedagem.findOne({
        where: { idTransacao },
        include: [{ model: ReservaSuite, as: 'ReservaSuite' }],
    });

    if (!hospedagem) {
        return;
    }

    if (hospedagem.status === StatusReservaHospedagem.Confirmada) {
        return;
    }

    if (hospedagem.status !== StatusReservaHospedagem.AguardandoPagamento) {
        return;
    }

    const dataConfirmacao = new Date();

    await connection.transaction(async (t: Transaction) => {
        await hospedagem.update(
            {
                status: StatusReservaHospedagem.Confirmada,
                dataConfirmacao,
            },
            { transaction: t }
        );

        const suites = (hospedagem as ReservaHospedagem & {
            ReservaSuite?: ReservaSuite[];
        }).ReservaSuite ?? [];

        for (const suite of suites) {
            await suite.update(
                { status: StatusReservaSuite.Confirmada },
                { transaction: t }
            );
        }

        await HistoricoTransacao.create(
            {
                idTransacao,
                idUsuario: hospedagem.idUsuario,
                data: new Date(),
                descricao: 'Hospedagem confirmada após pagamento.',
            },
            { transaction: t }
        );
    });

    console.log('Hospedagem confirmada');

    try {
        await notificarConfirmacaoHospedagem(hospedagem.id, idTransacao);
    } catch (error) {
        console.error(
            `Erro ao notificar confirmação da hospedagem ${hospedagem.id}:`,
            error
        );
    }
}

export async function suiteTemConflito(
    idEventoSuite: number,
    checkin: Date,
    checkout: Date,
    options?: {
        excludeReservaHospedagemId?: number;
        excludeReservaSuiteIds?: number[];
    }
): Promise<boolean> {
    const intervalo = { inicio: checkin, fim: checkout };
    const conflitos = await listarReservasSuiteConflitantes(
        idEventoSuite,
        intervalo,
        options
    );
    return conflitos.length > 0;
}

function validarSuitesSemDuplicata(suites: SuiteCheckoutItem[]): void {
    const ids = suites.map((s) => s.idEventoSuite);
    if (new Set(ids).size !== ids.length) {
        throw new CustomError(
            'Não é permitido incluir a mesma suíte mais de uma vez no checkout.',
            400,
            ''
        );
    }
}

export async function calcularCotacao(params: {
    idEventoSuite: number;
    checkin: Date;
    checkout: Date;
    adultos: number;
    criancas: number;
}) {
    const { idEventoSuite, checkin, checkout, adultos, criancas } = params;

    const suite = await EventoSuite.findByPk(idEventoSuite);
    if (!suite) {
        throw new CustomError('Suíte não encontrada.', 404, '');
    }

    if (!['Ativo', 'PDV'].includes(suite.status)) {
        throw new CustomError('Suíte não disponível para venda.', 400, '');
    }

    const noites = calcularNoitesHotelaria(checkin, checkout);
    calcularExtrasPousada(adultos, criancas, suite.qtdeMinimaPessoas, suite.qtdeMaximaPessoas);
    const totais = calcularTotaisSuitePousada(suite, adultos, criancas, noites);
    if (!totais) {
        throw new CustomError('Não foi possível calcular a cotação da suíte.', 400, '');
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

export async function listarSuitesDisponiveis(params: {
    idEvento: number;
    checkin: Date;
    checkout: Date;
}) {
    await cancelarReservasExpiradas();

    const { idEvento, checkin, checkout } = params;
    const noites = calcularNoitesHotelaria(checkin, checkout);

    const suites = await EventoSuite.findAll({
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
        const totaisBase = calcularTotaisSuitePousada(suite, min, 0, noites);
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

export async function checkoutHospedagem(params: {
    idEvento: number;
    idUsuario: number;
    checkin: Date;
    checkout: Date;
    suites: SuiteCheckoutItem[];
    /** online = aguarda pagamento; recepcao = Confirmada imediatamente */
    origem?: 'online' | 'recepcao';
    observacoes?: string | null;
    idUsuarioOperador?: number;
    /** Exclusivo recepção — pagamento antecipado (cria PagamentoHospedagem) */
    pagamento?: PagamentoRecepcaoInput | null;
}) {
    const {
        idEvento,
        idUsuario,
        checkin,
        checkout,
        suites,
        origem = 'online',
        observacoes,
        idUsuarioOperador,
        pagamento = null,
    } = params;

    if (!suites?.length) {
        throw new CustomError('Informe ao menos uma suíte no checkout.', 400, '');
    }

    validarSuitesSemDuplicata(suites);

    const isRecepcao = origem === 'recepcao';

    if (!isRecepcao && pagamento) {
        throw new CustomError(
            'Pagamento antecipado não permitido na reserva online.',
            400,
            ''
        );
    }

    // Reserva pública: janela oficial 16:00–19:00 / 08:00–13:00
    // Recepção: qualquer horário; se hoje, check-in deve ser > agora
    if (!isRecepcao) {
        validarHorarioCheckinHospedagem(checkin);
        validarHorarioCheckoutHospedagem(checkout);
    }
    validarCheckinPosteriorAoAgoraSeHoje(checkin);

    const noites = calcularNoitesHotelaria(checkin, checkout);
    const cotacoes: { item: SuiteCheckoutItem; cotacao: Awaited<ReturnType<typeof calcularCotacao>> }[] =
        [];

    for (const item of suites) {
        const cotacao = await calcularCotacao({
            idEventoSuite: item.idEventoSuite,
            checkin,
            checkout,
            adultos: item.adultos,
            criancas: item.criancas,
        });

        if (cotacao.idEvento !== idEvento) {
            throw new CustomError(
                `Suíte ${item.idEventoSuite} não pertence ao evento informado.`,
                400,
                ''
            );
        }

        const conflito = await suiteTemConflito(
            item.idEventoSuite,
            checkin,
            checkout
        );
        if (conflito) {
            throw new CustomError(
                `Suíte indisponível no período: ${cotacao.suite.nome}.`,
                409,
                ''
            );
        }

        cotacoes.push({ item, cotacao });
    }

    if (!isRecepcao) {
        for (const { item } of cotacoes) {
            if (item.desconto) {
                throw new CustomError(
                    'Desconto manual não permitido na reserva online.',
                    400,
                    ''
                );
            }
        }
    }

    type SuiteComTotais = {
        item: SuiteCheckoutItem;
        cotacao: (typeof cotacoes)[0]['cotacao'];
        preco: number;
        taxaServico: number;
        valorTotal: number;
        valorOriginal: number | null;
        descontoTipo: DescontoRecepcaoInput['tipo'] | null;
        descontoValor: number | null;
        valorFinal: number | null;
    };

    const suitesComTotais: SuiteComTotais[] = cotacoes.map(({ item, cotacao }) => {
        const precoOriginal = roundMoney(cotacao.totais.preco);
        const taxaOriginal = roundMoney(cotacao.totais.taxaServico);
        const valorOriginalTotal = roundMoney(cotacao.totais.valorTotal);

        if (isRecepcao && item.desconto) {
            validarDescontoRecepcao(valorOriginalTotal, item.desconto);
            const valorFinalDesconto = calcularValorFinalComDesconto(
                valorOriginalTotal,
                item.desconto
            );
            const repartido = aplicarDescontoProporcional(
                precoOriginal,
                taxaOriginal,
                valorFinalDesconto
            );
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

    const totaisHospedagem = suitesComTotais.reduce(
        (acc, suite) => ({
            preco: roundMoney(acc.preco + suite.preco),
            taxaServico: roundMoney(acc.taxaServico + suite.taxaServico),
            valorTotal: roundMoney(acc.valorTotal + suite.valorTotal),
        }),
        { preco: 0, taxaServico: 0, valorTotal: 0 }
    );

    if (isRecepcao) {
        validarPagamentoRecepcao(totaisHospedagem.valorTotal, pagamento);
    }

    const valorPagoRecepcao =
        isRecepcao && pagamento ? roundMoney(pagamento.valor) : 0;
    const saldoPendenteRecepcao = isRecepcao
        ? calcularSaldoPendente(totaisHospedagem.valorTotal, valorPagoRecepcao)
        : null;
    const quitada =
        isRecepcao &&
        reservaQuitada(totaisHospedagem.valorTotal, valorPagoRecepcao);

    const mapTipoPagamentoTransacao = (
        forma?: string | null
    ): TipoPagamento | undefined => {
        switch (forma) {
            case 'PIX':
                return TipoPagamento.Pix;
            case 'Dinheiro':
                return TipoPagamento.Dinheiro;
            case 'CartaoCredito':
                return TipoPagamento.Credito;
            case 'CartaoDebito':
                return TipoPagamento.Debito;
            default:
                return TipoPagamento.Dinheiro;
        }
    };

    const agora = new Date();

    const resultado = await connection.transaction(async (t: Transaction) => {
        const hospedagem = await ReservaHospedagem.create(
            {
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
                formaPagamentoRecepcao:
                    isRecepcao && valorPagoRecepcao > 0
                        ? pagamento?.formaPagamento ?? null
                        : null,
                observacaoPagamento:
                    isRecepcao && pagamento?.observacao
                        ? pagamento.observacao
                        : null,
                comprovantePagamento:
                    isRecepcao && pagamento?.comprovante
                        ? pagamento.comprovante
                        : null,
                origemReserva: isRecepcao ? 'ATENDENTE' : 'SITE',
                idUsuarioCriacao: isRecepcao
                    ? idUsuarioOperador || null
                    : null,
                status: isRecepcao
                    ? StatusReservaHospedagem.Confirmada
                    : StatusReservaHospedagem.AguardandoPagamento,
                dataConfirmacao: isRecepcao ? agora : null,
                observacoes: observacoes?.trim() || null,
                idTransacao: null,
            },
            { transaction: t }
        );

        const itens: ReservaSuite[] = [];

        for (const suite of suitesComTotais) {
            const { item, cotacao } = suite;
            const reservaItem = await ReservaSuite.create(
                {
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
                        ? StatusReservaSuite.Confirmada
                        : StatusReservaSuite.AguardandoPagamento,
                },
                { transaction: t }
            );

            for (const hospede of item.hospedes) {
                await ReservaHospede.create(
                    {
                        idReservaSuite: reservaItem.id,
                        nome: hospede.nome,
                        tipo: hospede.tipo,
                        dataNascimento: hospede.dataNascimento,
                    },
                    { transaction: t }
                );
            }

            itens.push(reservaItem);
        }

        const dataTransacao = agora;
        const transacao = await Transacao.create(
            {
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
                          dataPagamento:
                              valorPagoRecepcao > 0 ? agora : undefined,
                          tipoPagamento: mapTipoPagamentoTransacao(
                              pagamento?.formaPagamento
                          ),
                          valorRecebido: valorPagoRecepcao,
                      }
                    : {}),
            },
            { transaction: t }
        );

        for (const suite of suitesComTotais) {
            const { item, cotacao } = suite;
            const precoOriginalTransacao = roundMoney(cotacao.totais.preco);
            const valorDescontoTransacao =
                suite.valorOriginal != null
                    ? roundMoney(suite.valorOriginal - suite.valorTotal)
                    : 0;

            await EventoSuiteTransacao.create(
                {
                    idTransacao: transacao.id,
                    idEventoSuite: item.idEventoSuite,
                    precoOriginal: precoOriginalTransacao,
                    preco: suite.preco,
                    taxaServico: suite.taxaServico,
                    valorTotal: suite.valorTotal,
                    taxaServicoOriginal: roundMoney(cotacao.totais.taxaServico),
                    ...(valorDescontoTransacao > 0
                        ? {
                              tipoDesconto:
                                  suite.descontoTipo === 'PERCENTUAL'
                                      ? TipoDesconto.Percentual
                                      : TipoDesconto.Fixo,
                              valorDesconto: suite.descontoValor,
                              precoDesconto: suite.preco,
                          }
                        : {}),
                },
                { transaction: t }
            );
        }

        if (isRecepcao && valorPagoRecepcao > 0 && pagamento) {
            await PagamentoHospedagem.create(
                {
                    idReservaHospedagem: hospedagem.id,
                    valor: valorPagoRecepcao,
                    dataPagamento: agora,
                    formaPagamento: pagamento.formaPagamento,
                    comprovante: pagamento.comprovante ?? null,
                    observacao: pagamento.observacao ?? null,
                    idUsuario: idUsuarioOperador || idUsuario,
                },
                { transaction: t }
            );
        }

        const linhasDescontoHistorico = suitesComTotais
            .filter((s) => s.descontoTipo && s.descontoValor)
            .map((s) => {
                const nome =
                    s.cotacao.suite.nome ?? `Suíte ${s.item.idEventoSuite}`;
                return `${nome}: ${formatarDescontoHistorico({
                    tipo: s.descontoTipo!,
                    valor: s.descontoValor!,
                })}`;
            });

        let descricaoHistorico = isRecepcao
            ? 'Reserva criada pela recepção.'
            : 'Transação criada para hospedagem com múltiplas suítes (checkout pousada).';

        if (isRecepcao && linhasDescontoHistorico.length > 0) {
            descricaoHistorico += `\n\nDesconto aplicado:\n${linhasDescontoHistorico.join('\n')}`;
        }

        if (isRecepcao) {
            descricaoHistorico += `\n\nValor total:\n${formatarMoedaHistorico(
                totaisHospedagem.valorTotal
            )}\n\nPagamento recebido:\n${formatarMoedaHistorico(
                valorPagoRecepcao
            )}\n\nSaldo pendente:\n${formatarMoedaHistorico(
                saldoPendenteRecepcao ?? 0
            )}`;
        }

        await HistoricoTransacao.create(
            {
                idTransacao: transacao.id,
                idUsuario: isRecepcao
                    ? idUsuarioOperador || idUsuario
                    : idUsuario,
                data: dataTransacao,
                descricao: descricaoHistorico,
            },
            { transaction: t }
        );

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
            await notificarConfirmacaoHospedagem(
                resultado.hospedagem.id,
                resultado.hospedagem.idTransacao
            );
        } catch (error) {
            console.error(
                `Erro ao notificar reserva recepção ${resultado.hospedagem.id}:`,
                error
            );
        }
    }

    return resultado;
}

export function parseParamsDisponibilidade(query: any) {
    return {
        idEvento: parsePositiveInt(query.idEvento, 'idEvento', 1),
        checkin: parseDateTimeParam(query.checkin, 'checkin'),
        checkout: parseDateTimeParam(query.checkout, 'checkout'),
    };
}

export function parseParamsCotacao(query: any) {
    return {
        idEventoSuite: parsePositiveInt(query.idEventoSuite, 'idEventoSuite', 1),
        checkin: parseDateTimeParam(query.checkin, 'checkin'),
        checkout: parseDateTimeParam(query.checkout, 'checkout'),
        adultos: parsePositiveInt(query.adultos, 'adultos', 1),
        criancas: parsePositiveInt(query.criancas ?? 0, 'criancas', 0),
    };
}

export function parseSuitesCheckout(body: any): SuiteCheckoutItem[] {
    const suites = body?.suites;
    if (!Array.isArray(suites) || suites.length === 0) {
        throw new CustomError(
            'suites deve ser um array com ao menos um item.',
            400,
            ''
        );
    }

    return suites.map((s: any, index: number) => {
        const idEventoSuite = parsePositiveInt(
            s.idEventoSuite,
            `suites[${index}].idEventoSuite`,
            1
        );
        const adultos = parsePositiveInt(s.adultos, `suites[${index}].adultos`, 1);
        const criancas = parsePositiveInt(s.criancas ?? 0, `suites[${index}].criancas`, 0);
        const hospedes = parseHospedesSuite(s, index, adultos, criancas);
        const desconto = parseDescontoRecepcao(s?.desconto, index);
        return { idEventoSuite, adultos, criancas, hospedes, desconto };
    });
}

function parseHospedesSuite(
    suite: any,
    index: number,
    adultos: number,
    criancas: number
): HospedeCheckoutItem[] {
    const hospedes = suite?.hospedes;
    if (!Array.isArray(hospedes)) {
        throw new CustomError(
            `suites[${index}].hospedes é obrigatório.`,
            400,
            ''
        );
    }

    const totalEsperado = adultos + criancas;
    if (hospedes.length !== totalEsperado) {
        throw new CustomError(
            `suites[${index}].hospedes deve conter ${totalEsperado} hóspede(s).`,
            400,
            ''
        );
    }

    let adultosInformados = 0;
    let criancasInformadas = 0;
    const parsed: HospedeCheckoutItem[] = [];

    for (let hospedeIndex = 0; hospedeIndex < hospedes.length; hospedeIndex += 1) {
        const hospede = hospedes[hospedeIndex];
        const nome = String(hospede?.nome ?? '').trim();
        if (!nome) {
            throw new CustomError(
                `suites[${index}].hospedes[${hospedeIndex}].nome é obrigatório.`,
                400,
                ''
            );
        }

        const tipo = hospede?.tipo;
        if (tipo !== TipoReservaHospede.Adulto && tipo !== TipoReservaHospede.Crianca) {
            throw new CustomError(
                `suites[${index}].hospedes[${hospedeIndex}].tipo inválido.`,
                400,
                ''
            );
        }

        if (tipo === TipoReservaHospede.Adulto) {
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
            throw new CustomError(
                `suites[${index}].hospedes[${hospedeIndex}].dataNascimento é obrigatório para crianças.`,
                400,
                ''
            );
        }

        const dataNascimento = new Date(hospede.dataNascimento);
        if (Number.isNaN(dataNascimento.getTime())) {
            throw new CustomError(
                `suites[${index}].hospedes[${hospedeIndex}].dataNascimento inválida.`,
                400,
                ''
            );
        }

        const idade = calcularIdadeEmAnos(dataNascimento);
        if (idade > IDADE_MAXIMA_CRIANCA_HOSPEDAGEM) {
            throw new CustomError(
                `O hóspede "${nome}" tem ${idade} anos. A categoria Criança é válida somente até ${IDADE_MAXIMA_CRIANCA_HOSPEDAGEM} anos. Para hóspedes acima de ${IDADE_MAXIMA_CRIANCA_HOSPEDAGEM} anos, cadastre como Adulto.`,
                400,
                ''
            );
        }

        parsed.push({
            nome,
            tipo,
            dataNascimento,
        });
    }

    if (adultosInformados !== adultos) {
        throw new CustomError(
            `suites[${index}].hospedes deve conter ${adultos} adulto(s).`,
            400,
            ''
        );
    }

    if (criancasInformadas !== criancas) {
        throw new CustomError(
            `suites[${index}].hospedes deve conter ${criancas} criança(s).`,
            400,
            ''
        );
    }

    return parsed;
}

export type ResumoPagamentoHospedagem = {
    checkin: Date;
    checkout: Date;
    noites: number;
    suites: Array<{
        nomeSuite: string;
        adultos: number;
        criancas: number;
        subtotal: number;
    }>;
    subtotalGeral: number;
    taxaServico: number;
    valorTotal: number;
};

export async function obterResumoPagamentoPorTransacao(
    idTransacao: number
): Promise<ResumoPagamentoHospedagem | null> {
    const hospedagem = await ReservaHospedagem.findOne({
        where: { idTransacao },
        include: [
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                include: [
                    {
                        model: EventoSuite,
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

    const suites = (hospedagem as ReservaHospedagem & {
        ReservaSuite?: Array<
            ReservaSuite & { EventoSuite?: Pick<EventoSuite, 'nome'> }
        >;
    }).ReservaSuite ?? [];

    return {
        checkin: hospedagem.checkin,
        checkout: hospedagem.checkout,
        noites: hospedagem.noites,
        suites: suites.map((item) => ({
            nomeSuite: item.EventoSuite?.nome ?? `Suíte ${item.idEventoSuite}`,
            adultos: item.adultos,
            criancas: item.criancas,
            subtotal: toNumber(item.preco),
        })),
        subtotalGeral: toNumber(hospedagem.preco),
        taxaServico: toNumber(hospedagem.taxaServico),
        valorTotal: toNumber(hospedagem.valorTotal),
    };
}

export type ReservaConfirmadaResumo = {
    reserva: {
        id: number;
        status: string;
        checkin: Date;
        checkout: Date;
        noites: number;
        preco: number;
        taxaServico: number;
        valorTotal: number;
        dataConfirmacao: Date | null;
    };
    evento: {
        id: number;
        nome: string;
        imagem?: string | null;
    };
    suites: Array<{
        idReservaSuite: number;
        nome: string;
        adultos: number;
        criancas: number;
        preco: number;
        taxaServico: number;
        valorTotal: number;
        hospedes: Array<{
            nome: string;
            tipo: string;
            dataNascimento: string | null;
        }>;
    }>;
};

export async function obterReservaConfirmadaPorTransacao(
    idTransacao: number,
    idUsuario: number
): Promise<ReservaConfirmadaResumo | null> {
    const hospedagem = await ReservaHospedagem.findOne({
        where: { idTransacao, idUsuario },
        include: [
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'nome', 'imagem'],
            },
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                include: [
                    {
                        model: EventoSuite,
                        as: 'EventoSuite',
                        attributes: ['nome'],
                    },
                    {
                        model: ReservaHospede,
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

    const evento = (hospedagem as ReservaHospedagem & {
        Evento?: { id: number; nome: string; imagem?: string | null };
    }).Evento;

    const suites = (hospedagem as ReservaHospedagem & {
        ReservaSuite?: Array<
            ReservaSuite & {
                EventoSuite?: Pick<EventoSuite, 'nome'>;
                ReservaHospede?: Array<{
                    nome: string;
                    tipo: string;
                    dataNascimento?: Date | string | null;
                }>;
            }
        >;
    }).ReservaSuite ?? [];

    return {
        reserva: {
            id: hospedagem.id,
            status: hospedagem.status,
            checkin: hospedagem.checkin,
            checkout: hospedagem.checkout,
            noites: hospedagem.noites,
            preco: toNumber(hospedagem.preco),
            taxaServico: toNumber(hospedagem.taxaServico),
            valorTotal: toNumber(hospedagem.valorTotal),
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
            preco: toNumber(item.preco),
            taxaServico: toNumber(item.taxaServico),
            valorTotal: toNumber(item.valorTotal),
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
