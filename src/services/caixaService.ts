import { Op, literal } from 'sequelize';
import connection from '../database';
import {
    OrigemTransacao,
    Transacao,
    TransacaoPagamento,
} from '../models/Transacao';
import {
    PagamentoHospedagem,
    FormaPagamentoRecepcaoValor,
} from '../models/PagamentoHospedagem';
import { isFormaPagamentoForaDoCaixa } from '../utils/hospedagemPagamentoRecepcao';
import { toNumber } from '../utils/reservaSuiteUtils';
import { roundMoney } from '../utils/reservaSuitePricing';
import apiJango from '../api/apiJango';
import { logger } from '../utils/logger';

export const GATEWAYS_TEF = ['TEF Stone', 'POS Stone'] as const;

export type CaixaValoresDto = {
    totalVendido: number;
    totalRecebido: number;
};

export type CaixaGatewayDto = {
    ingressos: CaixaValoresDto;
    hospedagem: CaixaValoresDto;
    total: CaixaValoresDto;
};

export type CaixaPdvDto = CaixaValoresDto & {
    idCaixa: number | null;
    dataAbertura: Date | string | null;
    status: string | null;
};

export type CaixaResumoDto = {
    periodo: { dataInicio: string; dataFim: string };
    tef: CaixaGatewayDto;
    mercadoPago: CaixaGatewayDto;
    pdv: CaixaPdvDto;
    totalGeral: CaixaValoresDto;
};

/** Fuso do filtro do Caixa (dia comercial para conferência bancária). */
export const CAIXA_TIMEZONE = 'America/Sao_Paulo';
const CAIXA_UTC_OFFSET = '-03:00';

function isoDateAddDays(isoDate: string, days: number): string {
    const [ano, mes, dia] = isoDate.split('-').map((p) => Number(p));
    const utc = new Date(Date.UTC(ano, mes - 1, dia + days));
    const y = utc.getUTCFullYear();
    const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
    const d = String(utc.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Dia civil em Brasília: [início inclusivo, fim exclusivo) em instantes UTC.
 * Ex.: 27/09–27/09 → 2026-09-27T03:00:00.000Z até 2026-09-28T03:00:00.000Z.
 */
export function parsePeriodoCaixaBrasilia(dataInicio: string, dataFim: string) {
    const inicio = new Date(`${dataInicio}T00:00:00${CAIXA_UTC_OFFSET}`);
    const fimExclusive = new Date(
        `${isoDateAddDays(dataFim, 1)}T00:00:00${CAIXA_UTC_OFFSET}`
    );
    return { inicio, fimExclusive };
}

const SQL_PERIODO_DATA_PAGAMENTO_INGRESSOS = `
  t.data_pagamento >= :inicio AND t.data_pagamento < :fimExclusive
`;

const SQL_PERIODO_DATA_PAGAMENTO_HOSPEDAGEM = `
  ph.data_pagamento >= :inicio AND ph.data_pagamento < :fimExclusive
`;

function somarValores(a: CaixaValoresDto, b: CaixaValoresDto): CaixaValoresDto {
    return {
        totalVendido: roundMoney(a.totalVendido + b.totalVendido),
        totalRecebido: roundMoney(a.totalRecebido + b.totalRecebido),
    };
}

async function sumNumberFromQuery(
    sql: string,
    replacements: Record<string, unknown>
): Promise<number> {
    const [rows] = await connection.query(sql, { replacements });
    const row = (rows as Array<{ total?: unknown }>)[0];
    return roundMoney(toNumber(row?.total ?? 0));
}

/**
 * TEF → Ingressos: Transacao como contexto (Pago, TEF Stone, INGRESSOS);
 * valor somado em TransacaoPagamento TEF Stone efetivamente pagos (exclui Portaria na mesma transação).
 * Período: data_pagamento da Transacao em janela America/Sao_Paulo [início, fim exclusivo).
 */
async function agregarTefIngressos(
    inicio: Date,
    fimExclusive: Date
): Promise<CaixaValoresDto> {
    const [rows] = await connection.query(
        `
        SELECT
          COALESCE(SUM(tp.valor), 0) AS totalVendido,
          COALESCE(SUM(tp.valor), 0) AS totalRecebido
        FROM TransacaoPagamento tp
        INNER JOIN Transacao t ON t.id = tp.id_transacao
        WHERE t.status = 'Pago'
          AND t.gateway_pagamento = 'TEF Stone'
          AND t.origem_transacao = :origemIngressos
          AND ${SQL_PERIODO_DATA_PAGAMENTO_INGRESSOS}
          AND tp.status_pagamento = 'Pago'
          AND tp.gateway_pagamento = 'TEF Stone'
        `,
        {
            replacements: {
                inicio: inicio.toISOString(),
                fimExclusive: fimExclusive.toISOString(),
                origemIngressos: OrigemTransacao.INGRESSOS,
            },
        }
    );

    const data = (rows as Array<{
        totalVendido?: string | number;
        totalRecebido?: string | number;
    }>)[0];

    const total = roundMoney(toNumber(data?.totalVendido ?? 0));
    return {
        totalVendido: total,
        totalRecebido: roundMoney(toNumber(data?.totalRecebido ?? total)),
    };
}

function sqlExistsTefHospedagem(pagamentoRef: string): string {
    return `
  EXISTS (
    SELECT 1 FROM HospedagemPagamentoOperacao o
    WHERE (
      o.id_pagamento_hospedagem = ${pagamentoRef}.id
      OR (
        ${pagamentoRef}.comprovante IS NOT NULL
        AND ${pagamentoRef}.comprovante <> ''
        AND o.id_externo_super_tef = ${pagamentoRef}.comprovante
      )
    )
  )`;
}

/** TEF → Hospedagem: PagamentoHospedagem com operação SuperTEF. */
async function agregarTefHospedagem(
    inicio: Date,
    fimExclusive: Date
): Promise<CaixaValoresDto> {
    const total = await sumNumberFromQuery(
        `
        SELECT COALESCE(SUM(ph.valor), 0) AS total
        FROM PagamentoHospedagem ph
        WHERE ${SQL_PERIODO_DATA_PAGAMENTO_HOSPEDAGEM}
          AND ph.forma_pagamento <> 'RECEBIDO_OTA'
          AND ${sqlExistsTefHospedagem('ph')}
        `,
        {
            inicio: inicio.toISOString(),
            fimExclusive: fimExclusive.toISOString(),
        }
    );
    return { totalVendido: total, totalRecebido: total };
}

/** Mercado Pago → Ingressos: Transacao paga (exclui TEF, portaria e hospedagem). */
async function agregarMercadoPagoIngressos(
    inicio: Date,
    fimExclusive: Date
): Promise<CaixaValoresDto> {
    const gateways = [...GATEWAYS_TEF];
    const gatewaysPortaria = [...gateways, 'Portaria'];
    const [rows] = await connection.query(
        `
        SELECT
          COALESCE(SUM(t.valor_total), 0) AS totalVendido,
          COALESCE(SUM(t.valor_recebido), 0) AS totalRecebido
        FROM Transacao t
        WHERE t.status = 'Pago'
          AND ${SQL_PERIODO_DATA_PAGAMENTO_INGRESSOS}
          AND t.origem_transacao = :origemIngressos
          AND NOT EXISTS (
            SELECT 1 FROM ReservaHospedagem rh WHERE rh.id_transacao = t.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM EventoSuiteTransacao est WHERE est.id_transacao = t.id
          )
          AND t.gateway_pagamento NOT IN (:gatewaysPortaria)
          AND NOT EXISTS (
            SELECT 1 FROM TransacaoPagamento tp
            WHERE tp.id_transacao = t.id
              AND tp.gateway_pagamento IN (:gateways)
              AND tp.status_pagamento = 'Pago'
          )
        `,
        {
            replacements: {
                inicio: inicio.toISOString(),
                fimExclusive: fimExclusive.toISOString(),
                origemIngressos: OrigemTransacao.INGRESSOS,
                gateways,
                gatewaysPortaria,
            },
        }
    );

    const data = (rows as Array<{
        totalVendido?: string | number;
        totalRecebido?: string | number;
    }>)[0];

    return {
        totalVendido: roundMoney(toNumber(data?.totalVendido ?? 0)),
        totalRecebido: roundMoney(toNumber(data?.totalRecebido ?? 0)),
    };
}

const FORMAS_HOSPEDAGEM_EXCLUIDAS_CAIXA_MP = [
    FormaPagamentoRecepcaoValor.Dinheiro,
    FormaPagamentoRecepcaoValor.Transferencia,
    FormaPagamentoRecepcaoValor.Antecipado,
    FormaPagamentoRecepcaoValor.Outro,
] as const;

function formaElegivelMercadoPagoHospedagem(forma: string): boolean {
    if (isFormaPagamentoForaDoCaixa(forma)) {
        return false;
    }
    if (
        (FORMAS_HOSPEDAGEM_EXCLUIDAS_CAIXA_MP as readonly string[]).includes(
            forma
        )
    ) {
        return false;
    }
    return true;
}

async function pagamentoHospedagemEhMercadoPago(params: {
    formaPagamento: string;
    comprovante: string | null;
}): Promise<boolean> {
    const forma = String(params.formaPagamento ?? '');
    if (!formaElegivelMercadoPagoHospedagem(forma)) {
        return false;
    }
    if (forma === FormaPagamentoRecepcaoValor.LinkPagamento) {
        return true;
    }
    const comp = String(params.comprovante ?? '').trim();
    if (!comp) {
        return false;
    }
    const liquido = await resolverRecebidoLiquidoPorComprovante(comp);
    return liquido != null;
}

async function listarPagamentosHospedagemMercadoPago(
    inicio: Date,
    fimExclusive: Date
): Promise<Array<{ valor: number; comprovante: string | null }>> {
    const rows = await PagamentoHospedagem.findAll({
        attributes: ['valor', 'comprovante', 'formaPagamento'],
        where: {
            dataPagamento: {
                [Op.gte]: inicio,
                [Op.lt]: fimExclusive,
            },
            formaPagamento: {
                [Op.notIn]: ['RECEBIDO_OTA'],
            },
            [Op.and]: [
                literal(
                    `NOT (${sqlExistsTefHospedagem('PagamentoHospedagem')})`
                ),
            ],
        },
        raw: true,
    });

    const candidatos: Array<{
        valor: number;
        comprovante: string | null;
        formaPagamento: string;
    }> = [];

    for (const r of rows) {
        const forma = String(
            (r as { formaPagamento?: string }).formaPagamento ?? ''
        );
        candidatos.push({
            valor: roundMoney(toNumber((r as { valor?: unknown }).valor ?? 0)),
            comprovante:
                (r as { comprovante?: string | null }).comprovante ?? null,
            formaPagamento: forma,
        });
    }

    const resultado: Array<{ valor: number; comprovante: string | null }> = [];
    for (const p of candidatos) {
        if (await pagamentoHospedagemEhMercadoPago(p)) {
            resultado.push({ valor: p.valor, comprovante: p.comprovante });
        }
    }
    return resultado;
}

async function resolverRecebidoLiquidoPorComprovante(
    comprovante: string
): Promise<number | null> {
    const codigo = String(comprovante || '').trim();
    if (!codigo) {
        return null;
    }

    const tp = await TransacaoPagamento.findOne({
        where: {
            PagamentoCodigo: codigo,
            gatewayPagamento: {
                [Op.or]: [
                    'MercadoPago',
                    'MercadoPagoRemarcacao',
                    { [Op.like]: '%Mercado%' },
                ],
            },
        },
        include: [
            {
                model: Transacao,
                as: 'Transacao',
                attributes: ['valorRecebido'],
                required: true,
            },
        ],
    });

    const viaTp = (tp as { Transacao?: { valorRecebido?: unknown } } | null)
        ?.Transacao?.valorRecebido;
    if (viaTp != null && viaTp !== '') {
        return roundMoney(toNumber(viaTp));
    }

    const transacao = await Transacao.findOne({
        where: { idTransacaoRecebidoMP: codigo },
        attributes: ['valorRecebido'],
    });
    if (transacao?.valorRecebido != null) {
        return roundMoney(toNumber(transacao.valorRecebido));
    }

    return null;
}

/** Mercado Pago → Hospedagem: PagamentoHospedagem sem TEF; líquido via Transacao/TP pelo comprovante. */
async function agregarMercadoPagoHospedagem(
    inicio: Date,
    fimExclusive: Date
): Promise<CaixaValoresDto> {
    const pagamentos = await listarPagamentosHospedagemMercadoPago(
        inicio,
        fimExclusive
    );

    let totalVendido = 0;
    let totalRecebido = 0;

    for (const p of pagamentos) {
        totalVendido = roundMoney(totalVendido + p.valor);

        const comp = String(p.comprovante ?? '').trim();
        const liquido = comp
            ? await resolverRecebidoLiquidoPorComprovante(comp)
            : null;
        const recebido =
            liquido != null && liquido > 0 ? liquido : p.valor;
        totalRecebido = roundMoney(totalRecebido + recebido);
    }

    return { totalVendido, totalRecebido };
}

const PDV_VAZIO: CaixaPdvDto = {
    idCaixa: null,
    dataAbertura: null,
    status: null,
    totalVendido: 0,
    totalRecebido: 0,
};

async function obterResumoPdvJango(params: {
    dataInicio: string;
    dataFim: string;
}): Promise<CaixaPdvDto> {
    try {
        const resumo = await apiJango().getCaixaResumo({
            dataInicio: params.dataInicio,
            dataFim: params.dataFim,
        });
        if (!resumo) {
            return PDV_VAZIO;
        }
        return {
            idCaixa: resumo.idCaixa,
            dataAbertura: resumo.dataAbertura,
            status: resumo.status,
            totalVendido: resumo.totalVendido,
            totalRecebido: resumo.totalRecebido,
        };
    } catch (error) {
        logger.warn('Caixa admin: falha ao ler resumo PDV (Firebird)', {
            message: (error as Error)?.message,
        });
        return PDV_VAZIO;
    }
}

export async function obterResumoCaixa(params: {
    dataInicio: string;
    dataFim: string;
}): Promise<CaixaResumoDto> {
    const periodo = parsePeriodoCaixaBrasilia(
        params.dataInicio,
        params.dataFim
    );

    const [tefIngressos, tefHospedagem, mpIngressos, mpHospedagem, pdv] =
        await Promise.all([
            agregarTefIngressos(periodo.inicio, periodo.fimExclusive),
            agregarTefHospedagem(periodo.inicio, periodo.fimExclusive),
            agregarMercadoPagoIngressos(periodo.inicio, periodo.fimExclusive),
            agregarMercadoPagoHospedagem(periodo.inicio, periodo.fimExclusive),
            obterResumoPdvJango({
                dataInicio: params.dataInicio,
                dataFim: params.dataFim,
            }),
        ]);

    const tefTotal = somarValores(tefIngressos, tefHospedagem);
    const mpTotal = somarValores(mpIngressos, mpHospedagem);
    const totalGeral = somarValores(somarValores(tefTotal, mpTotal), pdv);

    return {
        periodo: {
            dataInicio: params.dataInicio,
            dataFim: params.dataFim,
        },
        tef: {
            ingressos: tefIngressos,
            hospedagem: tefHospedagem,
            total: tefTotal,
        },
        mercadoPago: {
            ingressos: mpIngressos,
            hospedagem: mpHospedagem,
            total: mpTotal,
        },
        pdv,
        totalGeral,
    };
}
