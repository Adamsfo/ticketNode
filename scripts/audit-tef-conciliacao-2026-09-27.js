/**
 * Auditoria TEF 27/09/2026 — somente leitura.
 * node --require dotenv/config scripts/audit-tef-conciliacao-2026-09-27.js
 */
require('dotenv/config');
const { databaseReady, default: conn } = require('../dist/database');
const ConexaoJango = require('../dist/database/ConexaoJango');
const apiJango = require('../dist/api/apiJango').default;

const DATA = '2026-09-27';
const INICIO = '2026-09-27T03:00:00.000Z';
const FIM = '2026-09-28T03:00:00.000Z';

function n(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}
function fmt(v) {
  return n(v).toFixed(2);
}

async function loadTransacoesTef() {
  const [rows] = await conn.query(
    `
    SELECT
      t.id,
      t.id_usuario AS idUsuario,
      t.data_transacao AS dataTransacao,
      t.data_pagamento AS dataPagamento,
      t.preco,
      t.taxa_servico AS taxaServico,
      t.valor_total AS valorTotal,
      t.valor_recebido AS valorRecebido,
      t.valor_taxa_processamento AS valorTaxaProcessamento,
      t.status,
      t.gateway_pagamento AS gatewayPagamento,
      t.origem_transacao AS origemTransacao,
      t.tipo_pagamento AS tipoPagamento
    FROM Transacao t
    WHERE t.status = 'Pago'
      AND t.gateway_pagamento = 'TEF Stone'
      AND t.origem_transacao = 'INGRESSOS'
      AND t.data_pagamento >= :inicio
      AND t.data_pagamento < :fim
    ORDER BY t.id
    `,
    { replacements: { inicio: INICIO, fim: FIM } }
  );
  return rows;
}

async function loadPagamentosPorTransacao(ids) {
  if (!ids.length) return new Map();
  const [rows] = await conn.query(
    `
    SELECT id, id_transacao AS idTransacao, pagamento_codigo AS PagamentoCodigo,
           gateway_pagamento AS gatewayPagamento, valor, status_pagamento AS statusPagamento,
           id_caixa_item AS idCaixaItem, created_at AS createdAt
    FROM TransacaoPagamento
    WHERE id_transacao IN (:ids)
    ORDER BY id_transacao, id
    `,
    { replacements: { ids } }
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.idTransacao)) map.set(r.idTransacao, []);
    map.get(r.idTransacao).push(r);
  }
  return map;
}

async function loadHistorico(ids) {
  if (!ids.length) return new Map();
  const [rows] = await conn.query(
    `
    SELECT id_transacao AS idTransacao, data, descricao, id_usuario AS idUsuario
    FROM HistoricoTransacao
    WHERE id_transacao IN (:ids)
    ORDER BY id_transacao, data, id
    `,
    { replacements: { ids } }
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.idTransacao)) map.set(r.idTransacao, []);
    map.get(r.idTransacao).push(r);
  }
  return map;
}

async function loadIngressosStatus(ids) {
  if (!ids.length) return new Map();
  const [rows] = await conn.query(
    `
    SELECT it.id_transacao AS idTransacao, i.id AS idIngresso, i.status AS statusIngresso
    FROM IngressoTransacao it
    INNER JOIN Ingresso i ON i.id = it.id_ingresso
    WHERE it.id_transacao IN (:ids)
    `,
    { replacements: { ids } }
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.idTransacao)) map.set(r.idTransacao, []);
    map.get(r.idTransacao).push(r);
  }
  return map;
}

async function queryPdvCaixaItemDia() {
  const qry = `
    SELECT
      ci.ID_CAIXA_ITEM,
      ci.ID_CAIXA,
      ci.DESCRICAO,
      ci.VALOR,
      ci.ID_FORMA_PAGAMENTO,
      c.DATA_ABERTURA
    FROM CAIXA_ITEM ci
    INNER JOIN CAIXA c ON c.ID_CAIXA = ci.ID_CAIXA
    WHERE CAST(c.DATA_ABERTURA AS DATE) = DATE '${DATA}'
      AND ci.TIPO_LANCAMENTO = 1
      AND ci.TIPO_VALOR = 'C'
    ORDER BY ci.ID_CAIXA_ITEM
  `;
  try {
    return await ConexaoJango.query(qry);
  } catch (e) {
    console.error('Firebird direto falhou, tentando API Jango:', e.message);
    const json = await apiJango().constructor
      ? null
      : null;
    const fetch = global.fetch;
    const base = process.env.JANGO_API_BASE || '';
    const url = base + '/select/' + encodeURIComponent(qry.replace(/\s+/g, ' ').trim());
    const res = await fetch(url);
    const text = await res.text();
    return JSON.parse(text);
  }
}

async function queryPdvViaApi() {
  const qry = `SELECT ci.ID_CAIXA_ITEM, ci.ID_CAIXA, ci.DESCRICAO, ci.VALOR, ci.ID_FORMA_PAGAMENTO, c.DATA_ABERTURA FROM CAIXA_ITEM ci INNER JOIN CAIXA c ON c.ID_CAIXA = ci.ID_CAIXA WHERE CAST(c.DATA_ABERTURA AS DATE) = DATE '${DATA}' AND ci.TIPO_LANCAMENTO = 1 AND ci.TIPO_VALOR = 'C' ORDER BY ci.ID_CAIXA_ITEM`;
  const base = process.env.JANGO_API_BASE || '';
  const res = await fetch(base + '/select/' + qry);
  const text = await res.text();
  return JSON.parse(text);
}

function pick(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k];
    const lower = k.toLowerCase();
    if (row[lower] !== undefined && row[lower] !== null) return row[lower];
  }
  return undefined;
}

function matchPdvItem(transacao, pagamentos, allItems) {
  const idTx = transacao.id;
  const hits = [];
  for (const item of allItems) {
    const desc = String(pick(item, 'DESCRICAO', 'descricao') || '');
    const valor = n(pick(item, 'VALOR', 'valor'));
    const idItem = pick(item, 'ID_CAIXA_ITEM', 'id_caixa_item');
    const forma = Number(pick(item, 'ID_FORMA_PAGAMENTO', 'id_forma_pagamento'));

    if (desc.includes(`Ingressos ${idTx}`)) {
      hits.push({ via: 'descricao_idTransacao', idItem, valor, desc, forma });
    }
    for (const tp of pagamentos) {
      if (tp.idCaixaItem && Number(tp.idCaixaItem) === Number(idItem)) {
        hits.push({ via: 'idCaixaItem_em_TP', idItem, valor, desc, forma, tpId: tp.id });
      }
      const cod = String(tp.PagamentoCodigo || '').trim();
      if (cod && desc.includes(cod)) {
        hits.push({ via: 'descricao_PagamentoCodigo', idItem, valor, desc, forma, cod });
      }
      if (cod && desc === `Ingressos ${cod}`) {
        hits.push({ via: 'descricao_Ingressos_cod', idItem, valor, desc, forma, cod });
      }
      if (desc === `Ingressos ${tp.id}`) {
        hits.push({ via: 'descricao_tp_id', idItem, valor, desc, forma, tpId: tp.id });
      }
    }
  }
  const uniq = [];
  const seen = new Set();
  for (const h of hits) {
    const k = `${h.idItem}:${h.via}`;
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push(h);
    }
  }
  return uniq;
}

(async () => {
  await databaseReady;

  const transacoes = await loadTransacoesTef();
  const ids = transacoes.map((t) => t.id);
  const pagMap = await loadPagamentosPorTransacao(ids);
  const histMap = await loadHistorico(ids);
  const ingMap = await loadIngressosStatus(ids);

  let sumTotal = 0;
  let sumRecebido = 0;
  for (const t of transacoes) {
    sumTotal = n(sumTotal + n(t.valorTotal));
    sumRecebido = n(sumRecebido + n(t.valorRecebido));
  }

  let pdvItems = [];
  try {
    pdvItems = await ConexaoJango.query(
      `SELECT ci.ID_CAIXA_ITEM, ci.ID_CAIXA, ci.DESCRICAO, ci.VALOR, ci.ID_FORMA_PAGAMENTO, c.DATA_ABERTURA
       FROM CAIXA_ITEM ci INNER JOIN CAIXA c ON c.ID_CAIXA = ci.ID_CAIXA
       WHERE CAST(c.DATA_ABERTURA AS DATE) = DATE '${DATA}' AND ci.TIPO_LANCAMENTO = 1 AND ci.TIPO_VALOR = 'C'
       ORDER BY ci.ID_CAIXA_ITEM`
    );
  } catch {
    pdvItems = await queryPdvViaApi();
  }

  const pdvResumo = await apiJango().getCaixaResumo({
    dataInicio: DATA,
    dataFim: DATA,
  });

  const tefFormas = new Set([39, 40, 42]);
  const pdvTefItems = pdvItems.filter((i) =>
    tefFormas.has(Number(pick(i, 'ID_FORMA_PAGAMENTO', 'id_forma_pagamento')))
  );
  const pdvDinheiro = pdvItems.filter(
    (i) => Number(pick(i, 'ID_FORMA_PAGAMENTO', 'id_forma_pagamento')) === 38
  );
  const sumPdvTef = pdvTefItems.reduce((s, i) => s + n(pick(i, 'VALOR', 'valor')), 0);
  const sumPdvDinheiro = pdvDinheiro.reduce(
    (s, i) => s + n(pick(i, 'VALOR', 'valor')),
 0
  );
  const sumPdvIngressosDesc = pdvItems
    .filter((i) => String(pick(i, 'DESCRICAO', 'descricao') || '').startsWith('Ingressos'))
    .reduce((s, i) => s + n(pick(i, 'VALOR', 'valor')), 0);

  console.log('=== 1–2. TRANSACOES TEF CAIXA (MySQL) ===');
  console.log('Periodo UTC:', INICIO, '->', FIM);
  console.log('Quantidade:', transacoes.length);
  console.log('SUM(valor_total):', fmt(sumTotal));
  console.log('SUM(valor_recebido):', fmt(sumRecebido));
  console.log('');

  const rows = [];
  for (const t of transacoes) {
    const pags = pagMap.get(t.id) || [];
    const hist = histMap.get(t.id) || [];
    const ings = ingMap.get(t.id) || [];
    const pdvHits = matchPdvItem(t, pags, pdvItems);
    const pdvValor = pdvHits.length
      ? n(
          pdvHits.reduce((m, h) => Math.max(m, h.valor), 0)
        )
      : 0;
    const diffPdv = n(n(t.valorRecebido) - pdvValor);
    const diffTotalReceb = n(n(t.valorTotal) - n(t.valorRecebido));

    const flags = [];
    if (diffTotalReceb !== 0) flags.push(`total≠recebido(${fmt(diffTotalReceb)})`);
    if (pags.some((p) => p.statusPagamento !== 'Pago')) flags.push('TP_nao_Pago');
    if (pags.length > 1) flags.push(`multi_TP(${pags.length})`);
    if (pags.length === 0) flags.push('sem_TP');
    const histCancel = hist.filter((h) =>
      /cancel|estorn|devol|falha|contest/i.test(String(h.descricao || ''))
    );
    if (histCancel.length) flags.push(`hist:${histCancel.length}`);
    const ingBad = ings.filter((i) =>
      ['Cancelado', 'Reembolsado'].includes(String(i.statusIngresso))
    );
    if (ingBad.length) flags.push('ingresso_cancel/reemb');

    let statusPdv = 'sem PDV';
    if (pdvHits.length === 1) statusPdv = 'encontrado';
    else if (pdvHits.length > 1) statusPdv = 'multiplos PDV';

    rows.push({
      id: t.id,
      valorCaixa: n(t.valorRecebido),
      valorTotal: n(t.valorTotal),
      valorPdv: pdvValor,
      statusPdv,
      diffPdv,
      pags,
      pdvHits,
      flags,
      dataPagamento: t.dataPagamento,
    });
  }

  console.log('=== LISTA TRANSACOES ===');
  for (const t of transacoes) {
    const pags = pagMap.get(t.id) || [];
    console.log(
      JSON.stringify({
        id: t.id,
        idUsuario: t.idUsuario,
        dataTransacao: t.dataTransacao,
        dataPagamento: t.dataPagamento,
        preco: n(t.preco),
        taxaServico: n(t.taxaServico),
        valorTotal: n(t.valorTotal),
        valorRecebido: n(t.valorRecebido),
        valorTaxaProcessamento: n(t.valorTaxaProcessamento),
        status: t.status,
        gateway: t.gatewayPagamento,
        origem: t.origemTransacao,
        tipoPagamento: t.tipoPagamento,
        pagamentos: pags,
      })
    );
  }
  console.log('');

  console.log('=== 4. TABELA CONCILIACAO (valor Caixa = valor_recebido) ===');
  console.log(
    '| Transacao | ValorTotal | ValorRecebido | Valor PDV | Status PDV | Diff Caixa-PDV | Flags |'
  );
  for (const r of rows) {
    console.log(
      `| ${r.id} | ${fmt(r.valorTotal)} | ${fmt(r.valorCaixa)} | ${fmt(r.valorPdv)} | ${r.statusPdv} | ${fmt(r.diffPdv)} | ${r.flags.join('; ') || '-'} |`
    );
  }

  const caixaSemPdv = rows.filter((r) => r.statusPdv === 'sem PDV');
  const caixaMaiorPdv = rows.filter((r) => r.diffPdv > 0.009);
  const pdvMatchedIds = new Set();
  for (const r of rows) {
    for (const h of r.pdvHits) pdvMatchedIds.add(Number(h.idItem));
  }
  const ingressosItems = pdvItems.filter((i) =>
    String(pick(i, 'DESCRICAO', 'descricao') || '').startsWith('Ingressos')
  );
  const pdvSemCaixa = ingressosItems.filter(
    (i) => !pdvMatchedIds.has(Number(pick(i, 'ID_CAIXA_ITEM', 'id_caixa_item')))
  );

  console.log('');
  console.log('=== CAIXA sem PDV (por transacao) ===');
  console.log(
    'IDs:',
    caixaSemPdv.map((r) => r.id).join(', ') || '(nenhum)'
  );
  console.log(
    'Soma valor_recebido:',
    fmt(caixaSemPdv.reduce((s, r) => s + r.valorCaixa, 0))
  );

  console.log('');
  console.log('=== CAIXA > PDV (diff positiva) ===');
  for (const r of caixaMaiorPdv) {
    console.log(
      `id ${r.id}: caixa ${fmt(r.valorCaixa)} pdv ${fmt(r.valorPdv)} diff ${fmt(r.diffPdv)} hits ${JSON.stringify(r.pdvHits)}`
    );
  }
  console.log(
    'Soma diffs positivas:',
    fmt(caixaMaiorPdv.reduce((s, r) => s + r.diffPdv, 0))
  );

  console.log('');
  console.log('=== PDV Ingressos sem match transacao TEF ===');
  for (const i of pdvSemCaixa) {
    console.log(
      JSON.stringify({
        id: pick(i, 'ID_CAIXA_ITEM', 'id_caixa_item'),
        valor: n(pick(i, 'VALOR', 'valor')),
        forma: pick(i, 'ID_FORMA_PAGAMENTO', 'id_forma_pagamento'),
        desc: pick(i, 'DESCRICAO', 'descricao'),
      })
    );
  }

  console.log('');
  console.log('=== 3. RESUMO PDV DIA ===');
  console.log('getCaixaResumo SALDO (recebido):', fmt(pdvResumo?.totalRecebido));
  console.log('getCaixaResumo RECEITA_BRUTA:', fmt(pdvResumo?.totalVendido));
  console.log('CAIXA_ITEM count dia:', pdvItems.length);
  console.log('CAIXA_ITEM TEF (39/40/42) sum:', fmt(sumPdvTef), 'count', pdvTefItems.length);
  console.log('CAIXA_ITEM Dinheiro (38) sum:', fmt(sumPdvDinheiro), 'count', pdvDinheiro.length);
  console.log('CAIXA_ITEM desc Ingressos* sum:', fmt(sumPdvIngressosDesc));

  console.log('');
  console.log('=== 5. BANCO ===');
  console.log(
    'Sem acesso ao extrato/detalle das 38 vendas. Total informado: R$ 5.850,00 (38 vendas).'
  );
  console.log('Quantidade transacoes TEF Caixa MySQL:', transacoes.length);

  console.log('');
  console.log('=== 9. TOTAIS ===');
  console.log('TOTAL CAIXA (SUM valor_recebido):', fmt(sumRecebido));
  console.log('TOTAL PDV (getCaixaResumo SALDO):', fmt(pdvResumo?.totalRecebido));
  console.log('TOTAL BANCO (informado):', '5850.00');
  console.log('Diff Caixa-PDV:', fmt(n(sumRecebido) - n(pdvResumo?.totalRecebido)));
  console.log('Diff Caixa-Banco:', fmt(n(sumRecebido) - 5850));
  console.log('Diff Banco-PDV:', fmt(5850 - n(pdvResumo?.totalRecebido)));

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
