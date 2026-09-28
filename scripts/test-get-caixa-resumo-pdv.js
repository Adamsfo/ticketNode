/**
 * Teste manual: node --require dotenv/config scripts/test-get-caixa-resumo-pdv.js
 */
require('dotenv/config');
const apiJango = require('../dist/api/apiJango').default;

const DATA = process.argv[2] || '2026-09-27';

apiJango()
  .getCaixaResumo({ dataInicio: DATA, dataFim: DATA })
  .then((res) => {
    console.log(JSON.stringify(res, null, 2));
    process.exit(res ? 0 : 2);
  })
  .catch((e) => {
    console.error('FALHA:', e.message);
    process.exit(1);
  });
