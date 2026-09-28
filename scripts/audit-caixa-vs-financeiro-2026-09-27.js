/**
 * Auditoria pontual — não altera dados. Uso: node --require dotenv/config scripts/audit-caixa-vs-financeiro-2026-09-27.js
 */
require('dotenv/config');
const { databaseReady, default: conn } = require('../dist/database');

const DATA = '2026-09-27';
const inicio = new Date(`${DATA}T00:00:00-04:00`);
const fim = new Date(`${DATA}T23:59:59.999-04:00`);
const inicioIso = inicio.toISOString();
const fimIso = fim.toISOString();
const gatewaysTef = ['TEF Stone', 'POS Stone'];

function n(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

function fmt(v) {
  return n(v).toFixed(2);
}

async function loadTransacaoPagamentos(ids) {
  if (!ids.length) return new Map();
  const [rows] = await conn.query(
    `SELECT id, id_transacao AS idTransacao, gateway_pagamento AS gatewayPagamento,
            status_pagamento AS statusPagamento, valor, pagamento_codigo AS pagamentoCodigo
     FROM TransacaoPagamento WHERE id_transacao IN (:ids)`,
    { replacements: { ids } }
  );
  const map = new Map();
  for (const r of rows) {
    const k = r.idTransacao;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

async function financeiroTransacoes(idEvento) {
  const [rows] = await conn.query(
    `SELECT t.id AS idTransacao, t.id_evento AS idEvento, t.origem_transacao AS origemTransacao,
            t.status, t.gateway_pagamento AS gatewayPagamento, t.valor_total AS valorTotal,
            t.preco, t.valor_recebido AS valorRecebido, t.data_pagamento AS dataPagamento
     FROM Transacao t
     WHERE t.status = 'Pago'
       AND t.id_evento = :idEvento
       AND t.data_pagamento BETWEEN :inicioIso AND :fimIso`,
    { replacements: { idEvento, inicioIso, fimIso } }
  );
  return rows;
}

async function financeiroGlobal() {
  const [rows] = await conn.query(
    `SELECT t.id AS idTransacao, t.id_evento AS idEvento, t.origem_transacao AS origemTransacao,
            t.status, t.gateway_pagamento AS gatewayPagamento, t.valor_total AS valorTotal,
            t.preco, t.valor_recebido AS valorRecebido, t.data_pagamento AS dataPagamento
     FROM Transacao t
     WHERE t.status = 'Pago'
       AND t.data_pagamento BETWEEN :inicioIso AND :fimIso`,
    { replacements: { inicioIso, fimIso } }
  );
  return rows;
}

async function caixaTefLinhas() {
  const [rows] = await conn.query(
    `
    SELECT t.id AS idTransacao, t.id_evento AS idEvento, t.origem_transacao AS origemTransacao,
           t.status, t.gateway_pagamento AS gatewayPagamento, t.valor_total AS valorTotal,
           t.valor_recebido AS valorRecebido, t.data_pagamento AS dataPagamento,
           tp.id AS idTransacaoPagamento, tp.gateway_pagamento AS tpGateway,
           tp.status_pagamento AS statusPagamento, tp.valor AS tpValor,
           tp.pagamento_codigo AS pagamentoCodigo,
           'TEF' AS caixaBucket
    FROM TransacaoPagamento tp
    INNER JOIN Transacao t ON t.id = tp.id_transacao
    WHERE t.status = 'Pago'
      AND t.data_pagamento BETWEEN :inicio AND :fim
      AND (t.origem_transacao IS NULL OR t.origem_transacao = 'INGRESSOS')
      AND NOT EXISTS (SELECT 1 FROM ReservaHospedagem rh WHERE rh.id_transacao = t.id)
      AND NOT EXISTS (SELECT 1 FROM EventoSuiteTransacao est WHERE est.id_transacao = t.id)
      AND tp.status_pagamento = 'Pago'
      AND (tp.gateway_pagamento IN (:gateways) OR t.gateway_pagamento IN (:gateways))
    `,
    { replacements: { inicio, fim, gateways: gatewaysTef } }
  );
  return rows;
}

async function caixaMpTransacoes() {
  const [rows] = await conn.query(
    `
    SELECT t.id AS idTransacao, t.id_evento AS idEvento, t.origem_transacao AS origemTransacao,
           t.status, t.gateway_pagamento AS gatewayPagamento, t.valor_total AS valorTotal,
           t.valor_recebido AS valorRecebido, t.data_pagamento AS dataPagamento,
           'MP' AS caixaBucket
    FROM Transacao t
    WHERE t.status = 'Pago'
      AND t.data_pagamento BETWEEN :inicio AND :fim
      AND (t.origem_transacao IS NULL OR t.origem_transacao = 'INGRESSOS')
      AND NOT EXISTS (SELECT 1 FROM ReservaHospedagem rh WHERE rh.id_transacao = t.id)
      AND NOT EXISTS (SELECT 1 FROM EventoSuiteTransacao est WHERE est.id_transacao = t.id)
      AND t.gateway_pagamento NOT IN ('TEF Stone', 'POS Stone', 'Portaria')
      AND NOT EXISTS (
        SELECT 1 FROM TransacaoPagamento tp
        WHERE tp.id_transacao = t.id
          AND tp.gateway_pagamento IN ('TEF Stone', 'POS Stone')
          AND tp.status_pagamento = 'Pago'
      )
    `,
    { replacements: { inicio, fim } }
  );
  return rows;
}

/** Conjunto desejado pelo usuário: origem_transacao = INGRESSOS apenas */
async function caixaDesejadoIngressos() {
  const [rows] = await conn.query(
    `
    SELECT t.id AS idTransacao, t.id_evento AS idEvento, t.origem_transacao AS origemTransacao,
           t.status, t.gateway_pagamento AS gatewayPagamento, t.valor_total AS valorTotal,
           t.valor_recebido AS valorRecebido, t.data_pagamento AS dataPagamento
    FROM Transacao t
    WHERE t.status = 'Pago'
      AND t.data_pagamento BETWEEN :inicio AND :fim
      AND t.origem_transacao = 'INGRESSOS'
    `,
    { replacements: { inicio, fim } }
  );
  return rows;
}

function sumFin(rows) {
  return {
    qtd: rows.length,
    vendidoPreco: n(rows.reduce((s, r) => s + n(r.preco), 0)),
    vendidoValorTotal: n(rows.reduce((s, r) => s + n(r.valorTotal), 0)),
    recebido: n(rows.reduce((s, r) => s + n(r.valorRecebido), 0)),
  };
}

function sumCaixaActual(tefRows, mpRows) {
  const tefV = n(tefRows.reduce((s, r) => s + n(r.tpValor), 0));
  const mpV = n(mpRows.reduce((s, r) => s + n(r.valorTotal), 0));
  const mpR = n(mpRows.reduce((s, r) => s + n(r.valorRecebido), 0));
  const ids = new Set([
    ...tefRows.map((r) => r.idTransacao),
    ...mpRows.map((r) => r.idTransacao),
  ]);
  return {
    qtdTransacoes: ids.size,
    vendido: n(tefV + mpV),
    recebido: n(tefV + mpR),
    tefV,
    mpV,
    mpR,
  };
}

function printTx(label, rows, tpMap) {
  console.log(`\n=== ${label} (${rows.length}) ===`);
  for (const r of rows) {
    console.log(
      JSON.stringify({
        idTransacao: r.idTransacao,
        idEvento: r.idEvento,
        origemTransacao: r.origemTransacao,
        status: r.status,
        gatewayPagamento: r.gatewayPagamento,
        valorTotal: n(r.valorTotal),
        preco: n(r.preco),
        valorRecebido: n(r.valorRecebido),
        dataPagamento: r.dataPagamento,
        caixaBucket: r.caixaBucket,
        transacaoPagamento: tpMap.get(r.idTransacao) || undefined,
      })
    );
  }
}

databaseReady
  .then(async () => {
    const [porEvento] = await conn.query(
      `SELECT t.id_evento AS idEvento,
              COUNT(*) AS qtd,
              SUM(t.preco) AS somaPreco,
              SUM(t.valor_recebido) AS somaRecebido
       FROM Transacao t
       WHERE t.status = 'Pago'
         AND t.data_pagamento BETWEEN :inicioIso AND :fimIso
       GROUP BY t.id_evento
       ORDER BY somaPreco DESC`,
      { replacements: { inicioIso, fimIso } }
    );

    console.log('--- Eventos com transações pagas no dia (Financeiro usa idEvento) ---');
    for (const e of porEvento) {
      console.log(
        `idEvento=${e.idEvento} qtd=${e.qtd} somaPreco=${fmt(e.somaPreco)} somaRecebido=${fmt(e.somaRecebido)}`
      );
    }

    const match6197 = porEvento.find((e) => Math.abs(n(e.somaPreco) - 6197) < 0.02);
    const idEventoFin = match6197 ? match6197.idEvento : porEvento[0]?.idEvento;
    console.log(`\n>>> idEvento alvo Financeiro (soma preco ~6197): ${idEventoFin}\n`);

    const finRows = await financeiroTransacoes(idEventoFin);
    const tefRows = await caixaTefLinhas();
    const mpRows = await caixaMpTransacoes();

    const finIds = new Set(finRows.map((r) => r.idTransacao));
    const caixaIds = new Set([
      ...tefRows.map((r) => r.idTransacao),
      ...mpRows.map((r) => r.idTransacao),
    ]);

    const both = finRows.filter((r) => caixaIds.has(r.idTransacao));
    const onlyFin = finRows.filter((r) => !caixaIds.has(r.idTransacao));
    const onlyCaixaMp = mpRows.filter((r) => !finIds.has(r.idTransacao));
    const onlyCaixaTefIds = [...new Set(tefRows.map((r) => r.idTransacao))].filter(
      (id) => !finIds.has(id)
    );
    const onlyCaixaTef = tefRows.filter((r) => onlyCaixaTefIds.includes(r.idTransacao));

    const caixaActual = sumCaixaActual(tefRows, mpRows);
    const finSum = sumFin(finRows);
    const bothSum = sumFin(both);
    const onlyFinSum = sumFin(onlyFin);

    const onlyCaixaRows = [
      ...onlyCaixaMp,
      ...onlyCaixaTef.filter(
        (r, i, arr) => arr.findIndex((x) => x.idTransacao === r.idTransacao) === i
      ),
    ];
    const onlyCaixaVendido = n(
      onlyCaixaMp.reduce((s, r) => s + n(r.valorTotal), 0) +
        onlyCaixaTef.reduce((s, r) => s + n(r.tpValor), 0)
    );
    const onlyCaixaRecebido = n(
      onlyCaixaMp.reduce((s, r) => s + n(r.valorRecebido), 0) +
        onlyCaixaTef.reduce((s, r) => s + n(r.tpValor), 0)
    );

    console.log('--- Totais Caixa atual (service) ---');
    console.log(JSON.stringify(caixaActual, null, 2));
    console.log('--- Totais Financeiro (idEvento selecionado) ---');
    console.log(JSON.stringify(finSum, null, 2));

    console.log('\n| Situação | Qtd | Vendido (Fin=preço / Cx=caixa) | Recebido |');
    console.log('|----------|-----|--------------------------------|----------|');
    console.log(
      `| Financeiro considera | ${finSum.qtd} | R$ ${fmt(finSum.vendidoPreco)} (preco) | R$ ${fmt(finSum.recebido)} |`
    );
    console.log(
      `| Caixa considera (trans.) | ${caixaActual.qtdTransacoes} | R$ ${fmt(caixaActual.vendido)} | R$ ${fmt(caixaActual.recebido)} |`
    );
    console.log(
      `| Nos dois | ${both.length} | Fin preco R$ ${fmt(bothSum.vendidoPreco)} / Cx misto* | R$ Fin ${fmt(bothSum.recebido)} |`
    );
    console.log(
      `| Só Financeiro | ${onlyFin.length} | R$ ${fmt(onlyFinSum.vendidoPreco)} (preco) | R$ ${fmt(onlyFinSum.recebido)} |`
    );
    console.log(
      `| Só Caixa | ${onlyCaixaRows.length} trans. | R$ ${fmt(onlyCaixaVendido)} | R$ ${fmt(onlyCaixaRecebido)} |`
    );
    console.log('* Cx nos dois: TEF soma tp.valor; MP soma valor_total por transação');

    const allDiffIds = [
      ...new Set([
        ...onlyFin.map((r) => r.idTransacao),
        ...onlyCaixaRows.map((r) => r.idTransacao),
      ]),
    ];
    const tpMap = await loadTransacaoPagamentos(allDiffIds);

    printTx('SÓ FINANCEIRO (não entram no Caixa atual)', onlyFin, tpMap);
    printTx('SÓ CAIXA MP (não no Financeiro deste evento)', onlyCaixaMp, tpMap);
    printTx('SÓ CAIXA TEF (não no Financeiro deste evento)', onlyCaixaTef, tpMap);

    // Ambos mas divergência de campo vendido
    const diverge = both.filter((r) => {
      const tefPart = tefRows.filter((x) => x.idTransacao === r.idTransacao);
      const mpPart = mpRows.find((x) => x.idTransacao === r.idTransacao);
      const cxV = tefPart.length
        ? n(tefPart.reduce((s, x) => s + n(x.tpValor), 0))
        : n(mpPart?.valorTotal);
      return Math.abs(n(r.preco) - cxV) > 0.01 || Math.abs(n(r.valorTotal) - cxV) > 0.01;
    });
    printTx('NOS DOIS mas preco/valorTotal != vendido Caixa', diverge, tpMap);

    const desejado = await caixaDesejadoIngressos();
    const desejadoIds = new Set(desejado.map((r) => r.idTransacao));
    const caixaComNull = [...caixaIds].filter((id) => {
      const row = desejado.find((d) => d.idTransacao === id) ||
        finRows.find((f) => f.idTransacao === id);
      return row && row.origemTransacao !== 'INGRESSOS';
    });

    console.log('\n--- origem_transacao = INGRESSOS (regra desejada) ---');
    console.log(
      `qtd=${desejado.length} vendido valor_total=${fmt(desejado.reduce((s, r) => s + n(r.valorTotal), 0))} recebido=${fmt(desejado.reduce((s, r) => s + n(r.valorRecebido), 0))}`
    );

    const finGlobal = await financeiroGlobal();
    console.log('\n--- Financeiro SEM filtro evento (referência global) ---');
    console.log(JSON.stringify(sumFin(finGlobal), null, 2));

    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
