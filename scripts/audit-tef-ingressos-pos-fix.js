require('dotenv/config');
const { databaseReady, default: conn } = require('../dist/database');
const {
    obterResumoCaixa,
    parsePeriodoCaixaBrasilia,
} = require('../dist/services/caixaService');

(async () => {
    await databaseReady;
    const p = parsePeriodoCaixaBrasilia('2026-09-27', '2026-09-27');
    const r = await obterResumoCaixa({
        dataInicio: '2026-09-27',
        dataFim: '2026-09-27',
    });

    const rep = {
        i: p.inicio.toISOString(),
        f: p.fimExclusive.toISOString(),
    };

    const [cnt] = await conn.query(
        `
    SELECT COUNT(DISTINCT t.id) AS n
    FROM Transacao t
    INNER JOIN TransacaoPagamento tp ON tp.id_transacao = t.id
    WHERE t.status = 'Pago'
      AND t.gateway_pagamento = 'TEF Stone'
      AND t.origem_transacao = 'INGRESSOS'
      AND t.data_pagamento >= :i AND t.data_pagamento < :f
      AND tp.status_pagamento = 'Pago'
      AND tp.gateway_pagamento = 'TEF Stone'
    `,
        { replacements: rep }
    );

    const [cntTp] = await conn.query(
        `
    SELECT COUNT(*) AS n
    FROM TransacaoPagamento tp
    INNER JOIN Transacao t ON t.id = tp.id_transacao
    WHERE t.status = 'Pago'
      AND t.gateway_pagamento = 'TEF Stone'
      AND t.origem_transacao = 'INGRESSOS'
      AND t.data_pagamento >= :i AND t.data_pagamento < :f
      AND tp.status_pagamento = 'Pago'
      AND tp.gateway_pagamento = 'TEF Stone'
    `,
        { replacements: rep }
    );

    console.log('TEF Ingressos (Caixa):', r.tef.ingressos);
    console.log('Transacoes distintas:', cnt[0].n);
    console.log('Linhas TransacaoPagamento TEF Pago:', cntTp[0].n);

    const ids = [12177, 12185, 12189, 12201];
    const [rows] = await conn.query(
        `
    SELECT t.id AS idTransacao, tp.id AS idTp, tp.valor, tp.gateway_pagamento AS gw,
           tp.status_pagamento AS st, tp.pagamento_codigo AS cod
    FROM Transacao t
    INNER JOIN TransacaoPagamento tp ON tp.id_transacao = t.id
    WHERE t.id IN (:ids)
    ORDER BY t.id, tp.id
    `,
        { replacements: { ids } }
    );

    for (const id of ids) {
        console.log('--- Transacao', id);
        for (const row of rows.filter((x) => x.idTransacao === id)) {
            const tef =
                row.st === 'Pago' && row.gw === 'TEF Stone';
            let motivo = 'TP TEF Stone Pago';
            if (row.gw === 'Portaria') motivo = 'gateway Portaria (dinheiro)';
            else if (row.st !== 'Pago') motivo = 'status_pagamento não Pago';
            else if (row.gw !== 'TEF Stone')
                motivo = `gateway ${row.gw}`;
            console.log({
                idTp: row.idTp,
                valor: row.valor,
                gateway: row.gw,
                status: row.st,
                cod: row.cod,
                entraTef: tef ? 'SIM' : 'NÃO',
                motivo,
            });
        }
    }
    process.exit(0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
