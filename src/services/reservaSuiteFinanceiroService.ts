import { Transaction } from 'sequelize';
import connection from '../database';
import {
    EventoSuiteTransacao,
    HistoricoTransacao,
    Transacao,
} from '../models/Transacao';
import { ReservaHospedagem, StatusReservaHospedagem } from '../models/ReservaHospedagem';
import { ReservaSuite } from '../models/ReservaSuite';
import { ReservaSuiteItemServico } from '../models/ReservaSuiteItemServico';
import { ReservaHospedagemTaxaAdicional } from '../models/ReservaHospedagemTaxaAdicional';
import { CustomError } from '../utils/customError';
import { calcularSaldoPendente } from '../utils/hospedagemPagamentoRecepcao';
import { roundMoney, toNumber } from '../utils/reservaSuitePricing';

export type ServicoSuiteInput = {
    id?: number;
    descricao: string;
    valor: number;
    ordem?: number;
};

export type TotaisFinanceirosSuite = {
    idReservaSuite: number;
    preco: number;
    taxaServico: number;
    valorHospedagem: number;
    valorServicos: number;
    valorTotal: number;
};

export type TotaisFinanceirosReserva = {
    preco: number;
    taxaServico: number;
    valorServicos: number;
    valorTotal: number;
    suites: TotaisFinanceirosSuite[];
};

/** Hospedagem congelada da linha: preço + taxa de plataforma (sem serviços adicionais). */
export function calcularValorHospedagemSuite(suite: {
    preco?: unknown;
    taxaServico?: unknown;
}): number {
    return roundMoney(toNumber(suite.preco) + toNumber(suite.taxaServico));
}

export function somarValorServicos(
    itens: Array<{ valor?: unknown }>
): number {
    return roundMoney(
        itens.reduce((acc, item) => acc + toNumber(item.valor), 0)
    );
}

export function calcularTotaisSuiteComServicos(
    suite: ReservaSuite | { id: number; preco?: unknown; taxaServico?: unknown },
    itens: Array<{ valor?: unknown }>
): TotaisFinanceirosSuite {
    const preco = roundMoney(toNumber(suite.preco));
    const taxaServico = roundMoney(toNumber(suite.taxaServico));
    const valorHospedagem = roundMoney(preco + taxaServico);
    const valorServicos = somarValorServicos(itens);
    const valorTotal = roundMoney(valorHospedagem + valorServicos);

    return {
        idReservaSuite: Number(suite.id),
        preco,
        taxaServico,
        valorHospedagem,
        valorServicos,
        valorTotal,
    };
}

export function calcularTotaisReservaComServicos(
    suites: Array<
        ReservaSuite & {
            ItemServico?: ReservaSuiteItemServico[];
        }
    >,
    taxasAdicionais: Array<{
        idReservaSuite?: number | null;
        valor?: unknown;
    }> = []
): TotaisFinanceirosReserva {
    const linhas = suites.map((suite) => {
        const base = calcularTotaisSuiteComServicos(
            suite,
            suite.ItemServico ?? []
        );
        const taxasVinculadas = somarTaxasAdicionaisVinculadasSuite(
            taxasAdicionais,
            Number(suite.id)
        );
        if (taxasVinculadas <= 0) {
            return base;
        }
        return {
            ...base,
            valorTotal: roundMoney(base.valorTotal + taxasVinculadas),
        };
    });

    return {
        preco: roundMoney(linhas.reduce((acc, l) => acc + l.preco, 0)),
        taxaServico: roundMoney(
            linhas.reduce((acc, l) => acc + l.taxaServico, 0)
        ),
        valorServicos: roundMoney(
            linhas.reduce((acc, l) => acc + l.valorServicos, 0)
        ),
        valorTotal: roundMoney(linhas.reduce((acc, l) => acc + l.valorTotal, 0)),
        suites: linhas,
    };
}

export type ValoresTransacaoFinanceiros = {
    preco: number;
    taxaServico: number;
    valorTotal: number;
};

/**
 * Recalcula Transacao/EventoSuiteTransacao mantendo a semântica do checkout:
 * - preco = preço da hospedagem + serviços adicionais
 * - taxaServico = taxa de plataforma (inalterada)
 * - valorTotal = preco + taxaServico
 */
export function recalcularTransacaoComServicos(params: {
    precoHospedagem: number;
    taxaServicoHospedagem: number;
    valorServicos: number;
}): ValoresTransacaoFinanceiros {
    const precoH = roundMoney(params.precoHospedagem);
    const taxaServico = roundMoney(params.taxaServicoHospedagem);
    const servicos = roundMoney(params.valorServicos);
    const preco = roundMoney(precoH + servicos);
    const valorTotal = roundMoney(preco + taxaServico);

    return { preco, taxaServico, valorTotal };
}

/** Linha por suíte em EventoSuiteTransacao — mesma semântica da Transacao agregada. */
export function recalcularLinhaEventoSuiteTransacaoComServicos(linha: {
    preco: number;
    taxaServico: number;
    valorServicos: number;
}): ValoresTransacaoFinanceiros {
    return recalcularTransacaoComServicos({
        precoHospedagem: linha.preco,
        taxaServicoHospedagem: linha.taxaServico,
        valorServicos: linha.valorServicos,
    });
}

type StatusTransacao =
    | 'Aguardando pagamento'
    | 'Aguardando confirmação'
    | 'Pago'
    | 'Cancelado';

/**
 * Status da Transacao após alteração de valor — mesmo critério do checkout
 * (reservaSuiteService): quitada → Pago; saldo pendente → Aguardando pagamento.
 */
/** Soma taxas adicionais manuais da reserva (nível ReservaHospedagem). */
export function somarValorTaxasAdicionais(
    itens: Array<{ valor?: unknown }>
): number {
    return somarValorServicos(itens);
}

/** Taxas vinculadas a uma ReservaSuite específica (idReservaSuite). */
export function somarTaxasAdicionaisVinculadasSuite(
    taxas: Array<{ idReservaSuite?: number | null; valor?: unknown }>,
    idReservaSuite: number
): number {
    const id = Number(idReservaSuite);
    return somarValorServicos(
        taxas.filter((taxa) => Number(taxa.idReservaSuite ?? 0) === id)
    );
}

/** Taxas gerais da reserva (sem vínculo com ReservaSuite). */
export function somarTaxasAdicionaisGeraisReserva(
    taxas: Array<{ idReservaSuite?: number | null; valor?: unknown }>
): number {
    return somarValorServicos(
        taxas.filter((taxa) => {
            const id = Number(taxa.idReservaSuite ?? 0);
            return !Number.isFinite(id) || id <= 0;
        })
    );
}

/**
 * Aplica taxas adicionais da reserva no checkout:
 * - valorTotalReserva = totaisSuites.valorTotal + taxas
 * - Transacao: preco += taxas; taxaServico inalterada; valorTotal = preco + taxaServico
 */
export function aplicarTaxasAdicionaisCheckout(
    totaisSuites: { preco: number; taxaServico: number; valorTotal: number },
    valorTaxasAdicionais: number
): {
    valorTotalReserva: number;
    transacao: ValoresTransacaoFinanceiros;
} {
    const taxas = roundMoney(valorTaxasAdicionais);
    const valorTotalReserva = roundMoney(totaisSuites.valorTotal + taxas);
    const transacao = recalcularTransacaoComServicos({
        precoHospedagem: totaisSuites.preco,
        taxaServicoHospedagem: totaisSuites.taxaServico,
        valorServicos: taxas,
    });

    return { valorTotalReserva, transacao };
}

export function validarInputTaxaAdicional(input: {
    descricao?: unknown;
    valor?: unknown;
}): { descricao: string; valor: number } {
    return validarInputServico(input);
}

export function resolverStatusTransacaoAposRecalculoValor(
    valorTotal: number,
    valorRecebido: number,
    statusAtual?: string | null
): StatusTransacao {
    if (String(statusAtual) === 'Cancelado') {
        return 'Cancelado';
    }

    const recebido = roundMoney(toNumber(valorRecebido));
    const total = roundMoney(valorTotal);
    const quitada = Math.round(recebido * 100) >= Math.round(total * 100);

    if (quitada) {
        return 'Pago';
    }

    return 'Aguardando pagamento';
}

const STATUS_BLOQUEIA_SERVICOS = new Set<string>([
    StatusReservaHospedagem.Cancelada,
    StatusReservaHospedagem.Expirada,
    StatusReservaHospedagem.CheckOutRealizado,
]);

export function statusPermiteServicosAdicionais(status: string): boolean {
    return !STATUS_BLOQUEIA_SERVICOS.has(String(status));
}

export function validarInputServico(input: {
    descricao?: unknown;
    valor?: unknown;
}): { descricao: string; valor: number } {
    const descricao = String(input.descricao ?? '').trim();
    if (!descricao) {
        throw new CustomError('Descrição do serviço é obrigatória.', 400, '');
    }
    if (descricao.length > 500) {
        throw new CustomError(
            'Descrição do serviço deve ter no máximo 500 caracteres.',
            400,
            ''
        );
    }

    const valor = roundMoney(Number(input.valor));
    if (!Number.isFinite(valor) || valor <= 0) {
        throw new CustomError(
            'Valor do serviço deve ser maior que zero.',
            400,
            ''
        );
    }

    return { descricao, valor };
}

type ReservaComSuites = ReservaHospedagem & {
    ReservaSuite?: Array<
        ReservaSuite & { ItemServico?: ReservaSuiteItemServico[] }
    >;
    TaxaAdicional?: ReservaHospedagemTaxaAdicional[];
    valorPago?: number;
};

async function carregarReservaParaRecalculo(
    idReservaHospedagem: number,
    transaction: Transaction
): Promise<ReservaComSuites> {
    const reserva = (await ReservaHospedagem.findByPk(idReservaHospedagem, {
        include: [
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                required: false,
                include: [
                    {
                        model: ReservaSuiteItemServico,
                        as: 'ItemServico',
                        required: false,
                        separate: true,
                        order: [['ordem', 'ASC'], ['id', 'ASC']],
                    },
                ],
            },
            {
                model: ReservaHospedagemTaxaAdicional,
                as: 'TaxaAdicional',
                required: false,
                separate: true,
                order: [['ordem', 'ASC'], ['id', 'ASC']],
            },
        ],
        transaction,
        lock: transaction.LOCK.UPDATE,
    })) as ReservaComSuites | null;

    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    return reserva;
}

/**
 * Recalcula totais da reserva/suítes e sincroniza Transacao + EventoSuiteTransacao.
 * Deve ser chamado dentro da mesma transação do CRUD de serviços.
 */
export async function recalcularFinanceiroReservaComServicos(
    idReservaHospedagem: number,
    transaction: Transaction,
    opts?: {
        idUsuarioHistorico?: number;
        descricaoHistorico?: string;
    }
): Promise<TotaisFinanceirosReserva> {
    const reserva = await carregarReservaParaRecalculo(
        idReservaHospedagem,
        transaction
    );

    const suites = reserva.ReservaSuite ?? [];
    if (!suites.length) {
        throw new CustomError('Reserva sem suíte vinculada.', 400, '');
    }

    const taxas = reserva.TaxaAdicional ?? [];
    const totais = calcularTotaisReservaComServicos(suites, taxas);
    const valorTaxasGerais = somarTaxasAdicionaisGeraisReserva(taxas);
    const valorTaxasAdicionaisTotal = somarValorTaxasAdicionais(taxas);
    const valorTotalReserva = roundMoney(
        totais.valorTotal + valorTaxasGerais
    );
    const valorPago = roundMoney(toNumber(reserva.valorPago ?? 0));

    if (valorTotalReserva < valorPago - 0.009) {
        throw new CustomError(
            'Valor total não pode ser menor que o valor já recebido.',
            400,
            ''
        );
    }

    const saldoPendente = calcularSaldoPendente(valorTotalReserva, valorPago);

    for (const linha of totais.suites) {
        await ReservaSuite.update(
            { valorTotal: linha.valorTotal },
            {
                where: { id: linha.idReservaSuite },
                transaction,
            }
        );
    }

    await reserva.update(
        {
            valorTotal: valorTotalReserva,
            saldoPendente,
        },
        { transaction }
    );

    if (reserva.idTransacao) {
        const transacao = await Transacao.findByPk(reserva.idTransacao, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        const transacaoValores = recalcularTransacaoComServicos({
            precoHospedagem: totais.preco,
            taxaServicoHospedagem: totais.taxaServico,
            valorServicos: roundMoney(
                totais.valorServicos + valorTaxasAdicionaisTotal
            ),
        });

        const valorRecebido = roundMoney(toNumber(transacao?.valorRecebido ?? 0));
        const novoStatus = resolverStatusTransacaoAposRecalculoValor(
            transacaoValores.valorTotal,
            valorRecebido,
            transacao?.status
        );

        await Transacao.update(
            {
                preco: transacaoValores.preco,
                taxaServico: transacaoValores.taxaServico,
                valorTotal: transacaoValores.valorTotal,
                status: novoStatus,
            },
            {
                where: { id: reserva.idTransacao },
                transaction,
            }
        );

        const linhasTransacao = await EventoSuiteTransacao.findAll({
            where: { idTransacao: reserva.idTransacao },
            transaction,
        });

        for (const linhaSuite of totais.suites) {
            const suiteRow = suites.find((s) => s.id === linhaSuite.idReservaSuite);
            if (!suiteRow) continue;

            const estTransacao = linhasTransacao.find(
                (t) => Number(t.idEventoSuite) === Number(suiteRow.idEventoSuite)
            );
            if (!estTransacao) continue;

            const linhaValores = recalcularLinhaEventoSuiteTransacaoComServicos({
                preco: linhaSuite.preco,
                taxaServico: linhaSuite.taxaServico,
                valorServicos: linhaSuite.valorServicos,
            });

            await estTransacao.update(
                {
                    preco: linhaValores.preco,
                    taxaServico: linhaValores.taxaServico,
                    valorTotal: linhaValores.valorTotal,
                },
                { transaction }
            );
        }

        if (opts?.descricaoHistorico && opts.idUsuarioHistorico) {
            await HistoricoTransacao.create(
                {
                    idTransacao: reserva.idTransacao,
                    idUsuario: opts.idUsuarioHistorico,
                    data: new Date(),
                    descricao: opts.descricaoHistorico,
                },
                { transaction }
            );
        }
    }

    return totais;
}

export function calcularValorTotalReservaAposSuites(
    valorSuites: number,
    valorTaxasAdicionais: number
): number {
    return roundMoney(
        roundMoney(valorSuites) + roundMoney(valorTaxasAdicionais)
    );
}

/** Ajusta o valor base (hospedagem + serviços) de UMA ReservaSuite, sem alterar as demais. */
export async function aplicarAjusteValorBaseReservaSuite(
    idReservaHospedagem: number,
    idReservaSuite: number,
    novoValorBase: number,
    transaction: Transaction
): Promise<void> {
    const reserva = await carregarReservaParaRecalculo(
        idReservaHospedagem,
        transaction
    );
    const suites = reserva.ReservaSuite ?? [];
    const suite = suites.find((s) => Number(s.id) === Number(idReservaSuite));
    if (!suite) {
        throw new CustomError(
            'Linha de suíte não pertence a esta reserva.',
            404,
            ''
        );
    }

    const totais = calcularTotaisSuiteComServicos(
        suite,
        suite.ItemServico ?? []
    );
    const valorBaseAtual = totais.valorTotal;
    const valorInformado = roundMoney(novoValorBase);

    if (!(valorInformado > 0)) {
        throw new CustomError(
            'Valor da suíte deve ser maior que zero.',
            400,
            ''
        );
    }
    if (valorBaseAtual <= 0) {
        throw new CustomError(
            'Suíte sem valor base para ajustar.',
            400,
            ''
        );
    }
    if (Math.abs(valorBaseAtual - valorInformado) <= 0.009) {
        return;
    }

    const fator = valorInformado / valorBaseAtual;
    const preco = roundMoney(toNumber(suite.preco) * fator);
    const taxaServico = roundMoney(toNumber(suite.taxaServico) * fator);
    await suite.update({ preco, taxaServico }, { transaction });

    for (const item of suite.ItemServico ?? []) {
        await item.update(
            { valor: roundMoney(toNumber(item.valor) * fator) },
            { transaction }
        );
    }
}

export async function aplicarAjusteProporcionalValorSuites(
    idReservaHospedagem: number,
    novoValorSuites: number,
    transaction: Transaction
): Promise<void> {
    const reserva = await carregarReservaParaRecalculo(
        idReservaHospedagem,
        transaction
    );
    const suites = reserva.ReservaSuite ?? [];
    if (!suites.length) {
        throw new CustomError('Reserva sem suíte vinculada.', 400, '');
    }

    const totais = calcularTotaisReservaComServicos(suites);
    const valorSuitesAtual = totais.valorTotal;
    const valorSuitesInformado = roundMoney(novoValorSuites);

    if (!(valorSuitesInformado > 0)) {
        throw new CustomError(
            'Valor das suítes deve ser maior que zero.',
            400,
            ''
        );
    }
    if (valorSuitesAtual <= 0) {
        throw new CustomError(
            'Reserva sem valor de suítes para ajustar.',
            400,
            ''
        );
    }
    if (Math.abs(valorSuitesAtual - valorSuitesInformado) <= 0.009) {
        return;
    }

    const fator = valorSuitesInformado / valorSuitesAtual;

    for (const suite of suites) {
        const preco = roundMoney(toNumber(suite.preco) * fator);
        const taxaServico = roundMoney(toNumber(suite.taxaServico) * fator);
        await suite.update({ preco, taxaServico }, { transaction });

        for (const item of suite.ItemServico ?? []) {
            await item.update(
                { valor: roundMoney(toNumber(item.valor) * fator) },
                { transaction }
            );
        }
    }
}

export async function executarRecalculoFinanceiroReserva(
    idReservaHospedagem: number,
    opts?: {
        idUsuarioHistorico?: number;
        descricaoHistorico?: string;
    }
): Promise<TotaisFinanceirosReserva> {
    return connection.transaction(async (transaction: Transaction) =>
        recalcularFinanceiroReservaComServicos(
            idReservaHospedagem,
            transaction,
            opts
        )
    );
}
