import { randomBytes } from 'crypto';
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
import {
    Transacao,
    EventoSuiteTransacao,
    HistoricoTransacao,
    TipoPagamento,
    OrigemTransacao,
} from '../models/Transacao';
import { TipoDesconto } from '../models/CupomPromocional';
import {
    FormaPagamentoRecepcaoValor,
    PagamentoHospedagem,
    type FormaPagamentoRecepcao,
} from '../models/PagamentoHospedagem';
import { Usuario } from '../models/Usuario';
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
    isFormaPagamentoRecepcao,
    PagamentoRecepcaoInput,
    reservaQuitada,
    validarPagamentoRecepcao,
} from '../utils/hospedagemPagamentoRecepcao';
import {
    calcularExtrasPousada,
    calcularNoitesHotelaria,
    calcularTotaisSuitePousada,
    periodosHospedagemConflitam,
    parseDateTimeParam,
    parsePositiveInt,
    roundMoney,
    toNumber,
    validarHorarioCheckinHospedagem,
    validarHorarioCheckoutHospedagem,
    validarCheckinNaoEmDataPassada,
    validarCheckinPosteriorAoAgoraSeHoje,
    type IntervaloDateTime,
} from '../utils/reservaSuiteUtils';
import {
    calcularDisponibilidadePeriodo,
    type ReservaDisponibilidadeInput,
    type StatusReservaDisponibilidade,
} from './suiteDisponibilidadeService';
import {
    montarUrlPublicaReserva,
    notificarConfirmacaoHospedagem,
    notificarLinkPagamentoHospedagem,
} from './hospedagemConfirmacaoNotificacao';

const STATUS_RESERVA_SUITE_OCUPA = [
    StatusReservaSuite.AguardandoPagamento,
    StatusReservaSuite.Confirmada,
    StatusReservaSuite.Hospedada,
];

/** Expiração legada do checkout online (CLIENTE/SITE) quando expiraEm está nulo. */
const MINUTOS_EXPIRACAO_RESERVA = 15;

/** Link externo /reserva/:token (recepção → enviar para cliente). */
const MINUTOS_EXPIRACAO_LINK_PAGAMENTO = 18;

/** Origens de reserva feitas pelo cliente (online) — compatível com produção (CLIENTE) e legado (SITE). */
const ORIGENS_RESERVA_CLIENTE_ONLINE = ['CLIENTE', 'SITE'] as const;

function minutosParaLimite(minutos: number): Date {
    return new Date(Date.now() - minutos * 60 * 1000);
}

function calcularExpiraEmLinkPagamento(desde: Date = new Date()): Date {
    return new Date(desde.getTime() + MINUTOS_EXPIRACAO_LINK_PAGAMENTO * 60 * 1000);
}

async function marcarReservaComoExpirada(
    hospedagem: ReservaHospedagem & { ReservaSuite?: ReservaSuite[] },
    descricaoHistorico: string
): Promise<void> {
    await connection.transaction(async (t: Transaction) => {
        await hospedagem.update(
            { status: StatusReservaHospedagem.Expirada },
            { transaction: t }
        );

        const suites = hospedagem.ReservaSuite ?? [];
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
                    descricao: descricaoHistorico,
                },
                { transaction: t }
            );
        }
    });
}

/** Gera token opaco para link /reserva/TOKEN. */
export function gerarTokenPagamentoReserva(): string {
    return randomBytes(32).toString('hex');
}
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
    /** Vínculo opcional com Usuario (resolvido por CPF na integração). */
    idUsuario?: number | null;
    cpf?: string | null;
    email?: string | null;
    telefone?: string | null;
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

        return periodosHospedagemConflitam(
            intervalo,
            intervaloHospedagem(hospedagem)
        );
    });
}

export async function cancelarReservasExpiradas(): Promise<number> {
    const agora = new Date();
    const limiteLegacy = minutosParaLimite(MINUTOS_EXPIRACAO_RESERVA);
    const limiteLink = minutosParaLimite(MINUTOS_EXPIRACAO_LINK_PAGAMENTO);

    // 1) expiraEm preenchido → usa a data
    // 2) nulo + CLIENTE/SITE → legado 15 min
    // 3) nulo + link externo (tokenPagamento) → 18 min a partir de createdAt
    const hospedagens = await ReservaHospedagem.findAll({
        where: {
            status: StatusReservaHospedagem.AguardandoPagamento,
            [Op.or]: [
                { expiraEm: { [Op.lt]: agora } },
                {
                    expiraEm: null,
                    origemReserva: { [Op.in]: [...ORIGENS_RESERVA_CLIENTE_ONLINE] },
                    createdAt: { [Op.lt]: limiteLegacy },
                },
                {
                    expiraEm: null,
                    tokenPagamento: { [Op.ne]: null },
                    createdAt: { [Op.lt]: limiteLink },
                },
            ],
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
        const temLink = Boolean(hospedagem.tokenPagamento);
        const minutos = temLink
            ? MINUTOS_EXPIRACAO_LINK_PAGAMENTO
            : MINUTOS_EXPIRACAO_RESERVA;
        await marcarReservaComoExpirada(
            hospedagem as ReservaHospedagem & { ReservaSuite?: ReservaSuite[] },
            `Reserva de hospedagem expirada por falta de pagamento (${minutos} minutos).`
        );
        quantidade += 1;
    }

    return quantidade;
}

/**
 * Bloqueia início de pagamento (PIX/MP) se a Transacao for de reserva
 * via link externo já expirada. Ingressos (sem ReservaHospedagem) → no-op.
 */
export async function assertTransacaoHospedagemPagaivel(
    idTransacao: number
): Promise<void> {
    const id = Number(idTransacao);
    if (!(id > 0)) return;

    await cancelarReservasExpiradas();

    const hospedagem = await ReservaHospedagem.findOne({
        where: { idTransacao: id },
        include: [{ model: ReservaSuite, as: 'ReservaSuite' }],
    });
    if (!hospedagem) return;

    // Só o link externo (/reserva/:token) entra nesta regra de 18 min.
    if (!hospedagem.tokenPagamento) return;

    if (hospedagem.status === StatusReservaHospedagem.Expirada) {
        throw new CustomError('Reserva expirada.', 400, '');
    }

    if (hospedagem.status !== StatusReservaHospedagem.AguardandoPagamento) {
        throw new CustomError('Reserva expirada.', 400, '');
    }

    const createdAt = new Date(
        (hospedagem as ReservaHospedagem & { createdAt?: Date }).createdAt ||
            hospedagem.expiraEm ||
            0
    );
    const limite =
        hospedagem.expiraEm != null
            ? new Date(hospedagem.expiraEm)
            : calcularExpiraEmLinkPagamento(createdAt);

    if (Date.now() >= limite.getTime()) {
        await marcarReservaComoExpirada(
            hospedagem as ReservaHospedagem & { ReservaSuite?: ReservaSuite[] },
            `Reserva de hospedagem expirada por falta de pagamento (${MINUTOS_EXPIRACAO_LINK_PAGAMENTO} minutos).`
        );
        throw new CustomError('Reserva expirada.', 400, '');
    }
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

/** Mapeia tipo/gateway da Transacao para a forma usada no financeiro da recepção. */
function mapearFormaPagamentoHospedagemExterno(
    tipoPagamento?: string | null,
    gatewayPagamento?: string | null
): FormaPagamentoRecepcao {
    const tipo = String(tipoPagamento || '').toLowerCase();
    if (tipo.includes('pix')) return FormaPagamentoRecepcaoValor.PIX;
    if (tipo.includes('débito') || tipo.includes('debito')) {
        return FormaPagamentoRecepcaoValor.CartaoDebito;
    }
    if (tipo.includes('crédito') || tipo.includes('credito')) {
        return FormaPagamentoRecepcaoValor.CartaoCredito;
    }
    if (tipo.includes('dinheiro')) return FormaPagamentoRecepcaoValor.Dinheiro;

    const gateway = String(gatewayPagamento || '').toLowerCase();
    if (gateway.includes('mercado') || gateway.includes('mp')) {
        return FormaPagamentoRecepcaoValor.PIX;
    }
    return FormaPagamentoRecepcaoValor.Outro;
}

function resolverFormaPagamentoRecepcao(
    forma: string | null | undefined
): FormaPagamentoRecepcao {
    if (isFormaPagamentoRecepcao(forma)) {
        return forma;
    }
    return FormaPagamentoRecepcaoValor.Outro;
}

/**
 * Confirma hospedagem após pagamento aprovado (webhook/PIX/cartão).
 * Para reservas da recepção (ATENDENTE / link ao cliente), quita o financeiro
 * nos mesmos campos do pagamento interno — sem alterar fluxo de ingressos.
 */
export async function confirmarHospedagem(idTransacao: number): Promise<void> {
    const hospedagem = await ReservaHospedagem.findOne({
        where: { idTransacao },
        include: [{ model: ReservaSuite, as: 'ReservaSuite' }],
    });

    if (!hospedagem) {
        return;
    }

    const valorTotal = roundMoney(toNumber(hospedagem.valorTotal));
    const valorPagoAtual = roundMoney(toNumber(hospedagem.valorPago ?? 0));
    const saldoAtual =
        hospedagem.saldoPendente != null
            ? roundMoney(toNumber(hospedagem.saldoPendente))
            : calcularSaldoPendente(valorTotal, valorPagoAtual);
    const jaQuitada = reservaQuitada(valorTotal, valorPagoAtual) && saldoAtual <= 0.009;

    if (
        hospedagem.status === StatusReservaHospedagem.Confirmada &&
        jaQuitada
    ) {
        return;
    }

    if (
        hospedagem.status !== StatusReservaHospedagem.AguardandoPagamento &&
        hospedagem.status !== StatusReservaHospedagem.Confirmada
    ) {
        return;
    }

    // Financeiro da recepção/link: mesmos campos do pagamento administrativo.
    // Reservas CLIENTE/SITE online mantêm só a confirmação de status (fluxo existente).
    const sincronizarFinanceiroRecepcao =
        hospedagem.origemReserva === 'ATENDENTE' ||
        Boolean(hospedagem.tokenPagamento);

    const transacao = await Transacao.findByPk(idTransacao);
    const dataConfirmacao = hospedagem.dataConfirmacao ?? new Date();

    let valorPago = valorPagoAtual;
    let saldoPendente = saldoAtual;
    let formaPagamentoRecepcao: FormaPagamentoRecepcao | null = isFormaPagamentoRecepcao(
        hospedagem.formaPagamentoRecepcao
    )
        ? hospedagem.formaPagamentoRecepcao
        : null;
    let comprovantePagamento = hospedagem.comprovantePagamento ?? null;
    let observacaoPagamento = hospedagem.observacaoPagamento ?? null;

    if (sincronizarFinanceiroRecepcao) {
        valorPago = roundMoney(toNumber(transacao?.valorRecebido ?? 0));
        if (valorPago <= 0) {
            valorPago = roundMoney(
                toNumber(transacao?.valorTotal ?? valorTotal)
            );
        }
        if (valorPago > valorTotal) {
            valorPago = valorTotal;
        }
        saldoPendente = calcularSaldoPendente(valorTotal, valorPago);
        formaPagamentoRecepcao = mapearFormaPagamentoHospedagemExterno(
            transacao?.tipoPagamento,
            transacao?.gatewayPagamento
        );
        if (!observacaoPagamento) {
            observacaoPagamento =
                'Pagamento confirmado pelo cliente (gateway).';
        }
        // comprovante: gateway normalmente não envia arquivo; preserva se já houver
        comprovantePagamento = hospedagem.comprovantePagamento ?? null;
    }

    const formaPagamentoRegistro = resolverFormaPagamentoRecepcao(
        formaPagamentoRecepcao
    );

    const precisavaConfirmarStatus =
        hospedagem.status === StatusReservaHospedagem.AguardandoPagamento;

    await connection.transaction(async (t: Transaction) => {
        await hospedagem.update(
            {
                status: StatusReservaHospedagem.Confirmada,
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
            },
            { transaction: t }
        );

        const suites = (hospedagem as ReservaHospedagem & {
            ReservaSuite?: ReservaSuite[];
        }).ReservaSuite ?? [];

        for (const suite of suites) {
            if (suite.status !== StatusReservaSuite.Confirmada) {
                await suite.update(
                    { status: StatusReservaSuite.Confirmada },
                    { transaction: t }
                );
            }
        }

        if (sincronizarFinanceiroRecepcao && valorPago > 0) {
            const qtdPagamentos = await PagamentoHospedagem.count({
                where: { idReservaHospedagem: hospedagem.id },
                transaction: t,
            });
            if (qtdPagamentos === 0) {
                await PagamentoHospedagem.create(
                    {
                        idReservaHospedagem: hospedagem.id,
                        valor: valorPago,
                        dataPagamento: transacao?.dataPagamento ?? dataConfirmacao,
                        formaPagamento: formaPagamentoRegistro,
                        comprovante: comprovantePagamento,
                        observacao: observacaoPagamento,
                        idUsuario: hospedagem.idUsuario,
                    },
                    { transaction: t }
                );
            }
        }

        await HistoricoTransacao.create(
            {
                idTransacao,
                idUsuario: hospedagem.idUsuario,
                data: new Date(),
                descricao: sincronizarFinanceiroRecepcao
                    ? `Hospedagem confirmada após pagamento. Valor pago: ${formatarMoedaHistorico(
                          valorPago
                      )}. Saldo pendente: ${formatarMoedaHistorico(
                          saldoPendente
                      )}.`
                    : 'Hospedagem confirmada após pagamento.',
            },
            { transaction: t }
        );
    });

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
            await notificarConfirmacaoHospedagem(hospedagem.id, idTransacao);
        } catch (error) {
            console.error(
                `Erro ao notificar confirmação da hospedagem ${hospedagem.id}:`,
                error
            );
        }
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

/**
 * Carrega ocupantes da suíte no formato do SuiteDisponibilidadeService.
 */
async function carregarReservasParaDisponibilidade(
    idEventoSuite: number,
    options?: {
        excludeReservaHospedagemId?: number;
        excludeReservaSuiteIds?: number[];
    }
): Promise<ReservaDisponibilidadeInput[]> {
    const excludeSuiteIds = new Set(options?.excludeReservaSuiteIds ?? []);
    const ocupantes = await ReservaSuite.findAll({
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

    const out: ReservaDisponibilidadeInput[] = [];
    for (const reserva of ocupantes) {
        if (excludeSuiteIds.has(reserva.id)) continue;
        if (
            options?.excludeReservaHospedagemId &&
            reserva.idReservaHospedagem === options.excludeReservaHospedagemId
        ) {
            continue;
        }
        const hospedagem = (reserva as ReservaSuite & {
            ReservaHospedagem?: ReservaHospedagem;
        }).ReservaHospedagem;
        if (!hospedagem) continue;
        out.push({
            id: hospedagem.id,
            status: hospedagem.status as StatusReservaDisponibilidade,
            checkin: hospedagem.checkin,
            checkout: hospedagem.checkout,
            dataHoraCheckinReal:
                (hospedagem as ReservaHospedagem & {
                    dataHoraCheckinReal?: Date | null;
                }).dataHoraCheckinReal ?? null,
            dataHoraCheckoutRealizado:
                (hospedagem as ReservaHospedagem & {
                    dataHoraCheckoutRealizado?: Date | null;
                }).dataHoraCheckoutRealizado ?? null,
            saldoPendente: toNumber(
                (hospedagem as ReservaHospedagem & { saldoPendente?: number })
                    .saldoPendente ?? 0
            ),
        });
    }
    return out;
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
        // Parte 4: decisão exclusiva do SuiteDisponibilidadeService (matriz §4).
        const reservas = await carregarReservasParaDisponibilidade(suite.id);
        const disp = calcularDisponibilidadePeriodo({
            idEventoSuite: suite.id,
            checkin,
            checkout,
            reservas,
        });
        if (!disp.podeReservar) {
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

export async function checkoutHospedagem(params: {
    idEvento: number;
    idUsuario: number;
    checkin: Date;
    checkout: Date;
    suites: SuiteCheckoutItem[];
    /**
     * online = aguarda pagamento + janela horária pública
     * recepcao = Confirmada (ou link cliente)
     * integracao = mesmo comportamento de confirmação da recepção,
     *              com origemReserva = HOSPEDIN (canal externo)
     */
    origem?: 'online' | 'recepcao' | 'integracao';
    /**
     * Recepção: cria AguardandoPagamento + token/link para o cliente pagar
     * na infraestrutura de pagamentos existente (não altera fluxo de ingressos).
     */
    enviarParaCliente?: boolean;
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
        enviarParaCliente = false,
        observacoes,
        idUsuarioOperador,
        pagamento = null,
    } = params;

    if (!suites?.length) {
        throw new CustomError('Informe ao menos uma suíte no checkout.', 400, '');
    }

    validarSuitesSemDuplicata(suites);

    const isIntegracao = origem === 'integracao';
    const isRecepcao = origem === 'recepcao' || isIntegracao;
    const isLinkCliente = origem === 'recepcao' && !!enviarParaCliente;
    /** Confirma na hora (recepção tradicional / integração). Link ao cliente NÃO confirma. */
    const confirmaImediatamente = isRecepcao && !isLinkCliente;

    if (!isRecepcao && pagamento) {
        throw new CustomError(
            'Pagamento antecipado não permitido na reserva online.',
            400,
            ''
        );
    }

    if (isLinkCliente && pagamento) {
        throw new CustomError(
            'Pagamento antecipado não permitido ao enviar a reserva para o cliente finalizar.',
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
    validarCheckinNaoEmDataPassada(checkin);
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

    if (confirmaImediatamente) {
        validarPagamentoRecepcao(totaisHospedagem.valorTotal, pagamento);
    }

    const valorPagoRecepcao =
        confirmaImediatamente && pagamento ? roundMoney(pagamento.valor) : 0;
    const saldoPendenteRecepcao = confirmaImediatamente
        ? calcularSaldoPendente(totaisHospedagem.valorTotal, valorPagoRecepcao)
        : isLinkCliente
          ? totaisHospedagem.valorTotal
          : null;
    const quitada =
        confirmaImediatamente &&
        reservaQuitada(totaisHospedagem.valorTotal, valorPagoRecepcao);

    const tokenPagamento = isLinkCliente ? gerarTokenPagamentoReserva() : null;

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
                valorPago: confirmaImediatamente ? valorPagoRecepcao : 0,
                saldoPendente: confirmaImediatamente
                    ? saldoPendenteRecepcao
                    : totaisHospedagem.valorTotal,
                formaPagamentoRecepcao:
                    confirmaImediatamente && valorPagoRecepcao > 0
                        ? pagamento?.formaPagamento ?? null
                        : null,
                observacaoPagamento:
                    confirmaImediatamente && pagamento?.observacao
                        ? pagamento.observacao
                        : null,
                comprovantePagamento:
                    confirmaImediatamente && pagamento?.comprovante
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
                    ? StatusReservaHospedagem.Confirmada
                    : StatusReservaHospedagem.AguardandoPagamento,
                dataConfirmacao: confirmaImediatamente ? agora : null,
                observacoes: observacoes?.trim() || null,
                idTransacao: null,
                tokenPagamento,
                // Link externo: expira 18 min após a criação (createdAt / agora).
                expiraEm: isLinkCliente
                    ? calcularExpiraEmLinkPagamento(agora)
                    : null,
                linkPagamentoEnviadoEm: null,
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
                    status: confirmaImediatamente
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
                        ...(hospede.idUsuario != null
                            ? { idUsuario: Number(hospede.idUsuario) }
                            : {}),
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
                status: confirmaImediatamente
                    ? quitada
                        ? 'Pago'
                        : 'Aguardando pagamento'
                    : 'Aguardando pagamento',
                aceiteCompra: true,
                idEvento,
                origemTransacao: OrigemTransacao.HOSPEDAGEM,
                ...(confirmaImediatamente
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

        if (confirmaImediatamente && valorPagoRecepcao > 0 && pagamento) {
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

        let descricaoHistorico = isLinkCliente
            ? 'Reserva criada pela recepção — aguardando pagamento do cliente (link).'
            : isRecepcao
              ? 'Reserva criada pela recepção.'
              : 'Transação criada para hospedagem com múltiplas suítes (checkout pousada).';

        if (isRecepcao && linhasDescontoHistorico.length > 0) {
            descricaoHistorico += `\n\nDesconto aplicado:\n${linhasDescontoHistorico.join('\n')}`;
        }

        if (confirmaImediatamente) {
            descricaoHistorico += `\n\nValor total:\n${formatarMoedaHistorico(
                totaisHospedagem.valorTotal
            )}\n\nPagamento recebido:\n${formatarMoedaHistorico(
                valorPagoRecepcao
            )}\n\nSaldo pendente:\n${formatarMoedaHistorico(
                saldoPendenteRecepcao ?? 0
            )}`;
        }

        if (isLinkCliente && tokenPagamento) {
            descricaoHistorico += `\n\nLink de pagamento gerado:\n${montarUrlPublicaReserva(
                tokenPagamento
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

    if (confirmaImediatamente && resultado.hospedagem.idTransacao) {
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

    if (isLinkCliente && resultado.hospedagem.idTransacao) {
        try {
            await notificarLinkPagamentoHospedagem(resultado.hospedagem.id);
        } catch (error) {
            console.error(
                `Erro ao enviar link de pagamento da reserva ${resultado.hospedagem.id}:`,
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

/** Consulta pública da reserva pelo token do link (sem autenticação). */
export async function obterReservaPublicaPorToken(token: string) {
    const tokenLimpo = String(token || '').trim();
    if (!tokenLimpo || tokenLimpo.length < 16) {
        throw new CustomError('Token inválido.', 400, '');
    }

    // Expira imediatamente se já passou o prazo (antes de montar a tela).
    await cancelarReservasExpiradas();

    const hospedagem = await ReservaHospedagem.findOne({
        where: { tokenPagamento: tokenLimpo },
        include: [
            {
                model: Usuario,
                as: 'Usuario',
                attributes: ['id', 'nomeCompleto', 'sobreNome', 'email', 'telefone'],
                required: false,
            },
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'nome', 'imagem'],
                required: false,
            },
            {
                model: Transacao,
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
        throw new CustomError('Reserva não encontrada.', 404, '');
    }

    // Garantia pontual: link vencido por createdAt/expiraEm mesmo se o job ainda não rodou.
    if (
        hospedagem.status === StatusReservaHospedagem.AguardandoPagamento &&
        hospedagem.tokenPagamento
    ) {
        const createdAt = new Date(
            (hospedagem as ReservaHospedagem & { createdAt?: Date }).createdAt ||
                Date.now()
        );
        const limite =
            hospedagem.expiraEm != null
                ? new Date(hospedagem.expiraEm)
                : calcularExpiraEmLinkPagamento(createdAt);
        if (Date.now() >= limite.getTime()) {
            await marcarReservaComoExpirada(
                hospedagem as ReservaHospedagem & {
                    ReservaSuite?: ReservaSuite[];
                },
                `Reserva de hospedagem expirada por falta de pagamento (${MINUTOS_EXPIRACAO_LINK_PAGAMENTO} minutos).`
            );
            hospedagem.status = StatusReservaHospedagem.Expirada;
        }
    }

    const usuario = (hospedagem as ReservaHospedagem & { Usuario?: Usuario })
        .Usuario;
    const evento = (hospedagem as ReservaHospedagem & { Evento?: Evento })
        .Evento;
    const transacao = (hospedagem as ReservaHospedagem & {
        Transacao?: Transacao;
    }).Transacao;
    const suites = (hospedagem as ReservaHospedagem & {
        ReservaSuite?: Array<ReservaSuite & { EventoSuite?: EventoSuite }>;
    }).ReservaSuite ?? [];

    const totalAdultos = suites.reduce((s, i) => s + (i.adultos || 0), 0);
    const totalCriancas = suites.reduce((s, i) => s + (i.criancas || 0), 0);
    const nomeCliente = [usuario?.nomeCompleto, (usuario as any)?.sobreNome]
        .map((p) => String(p || '').trim())
        .filter(Boolean)
        .join(' ')
        .trim();

    const expirada =
        hospedagem.status === StatusReservaHospedagem.Expirada;
    const podePagar =
        !expirada &&
        hospedagem.status === StatusReservaHospedagem.AguardandoPagamento &&
        !!hospedagem.idTransacao &&
        transacao?.status !== 'Pago';

    return {
        origemPagamento: 'HOSPEDAGEM' as const,
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
            preco: toNumber(suite.preco),
            taxaServico: toNumber(suite.taxaServico),
            valorTotal: toNumber(suite.valorTotal),
        })),
        valores: {
            preco: toNumber(hospedagem.preco),
            taxaServico: toNumber(hospedagem.taxaServico),
            valorTotal: toNumber(hospedagem.valorTotal),
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
                      preco: toNumber(transacao.preco),
                      taxaServico: toNumber(transacao.taxaServico),
                      valorTotal: toNumber(transacao.valorTotal),
                      valorRecebido: toNumber(transacao.valorRecebido ?? 0),
                      idEvento: hospedagem.idEvento,
                  }
                : null,
        },
    };
}
