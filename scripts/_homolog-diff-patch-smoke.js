/**
 * Smoke test offline: Diff + PatchBuilder (sem DB/API).
 * node scripts/_homolog-diff-patch-smoke.js
 */
require('ts-node/register/transpile-only');

const {
  reservationDiffService,
} = require('../src/integrations/hospedin/services/ReservationDiffService');
const {
  reservationPatchBuilder,
} = require('../src/integrations/hospedin/services/ReservationPatchBuilder');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const base = {
  checkin: new Date('2026-08-01T17:00:00.000Z'),
  checkout: new Date('2026-08-03T15:00:00.000Z'),
  idEventoSuite: 10,
  observacoes: 'Hospedin #ABC',
  adultos: 2,
  criancas: 0,
  hospedes: [{ nome: 'Ana', tipo: 'Adulto', dataNascimento: null }],
};

// UNCHANGED
{
  const diff = reservationDiffService.diff(base, { ...base });
  assert(diff.hasChanges === false, 'expected no changes');
  const patch = reservationPatchBuilder.buildFromDiff(diff);
  assert(Object.keys(patch).length === 0, 'patch should be empty');
  console.log('OK unchanged');
}

// dates
{
  const after = {
    ...base,
    checkout: new Date('2026-08-04T15:00:00.000Z'),
  };
  const diff = reservationDiffService.diff(base, after);
  assert(diff.hasChanges, 'dates should change');
  assert(diff.changes.some((c) => c.field === 'checkout'), 'checkout in changes');
  const patch = reservationPatchBuilder.buildFromDiff(diff);
  assert(patch.checkout != null, 'patch.checkout');
  assert(patch.checkin == null, 'checkin unchanged → absent');
  console.log('OK dates');
}

// suite
{
  const after = { ...base, idEventoSuite: 99 };
  const diff = reservationDiffService.diff(base, after);
  const patch = reservationPatchBuilder.buildFromDiff(diff);
  assert(patch.idEventoSuite === 99, 'suite patch');
  console.log('OK suite');
}

// observacoes
{
  const after = { ...base, observacoes: 'Hospedin #ABC — nova nota' };
  const diff = reservationDiffService.diff(base, after);
  const patch = reservationPatchBuilder.buildFromDiff(diff);
  assert(patch.observacoes && patch.observacoes.includes('nova nota'), 'obs');
  console.log('OK observacoes');
}

// hospedes replace
{
  const after = {
    ...base,
    adultos: 1,
    criancas: 1,
    hospedes: [
      { nome: 'Ana', tipo: 'Adulto', dataNascimento: null },
      { nome: 'Bob', tipo: 'Crianca', dataNascimento: '2018-01-01' },
    ],
  };
  const diff = reservationDiffService.diff(base, after);
  assert(diff.changes.some((c) => c.field === 'hospedes'), 'hospedes');
  assert(diff.changes.some((c) => c.field === 'criancas'), 'criancas');
  const patch = reservationPatchBuilder.buildFromDiff(diff);
  assert(Array.isArray(patch.hospedesReplace), 'replace list');
  assert(patch.hospedesReplace.length === 2, '2 guests');
  console.log('OK hospedes');
}

console.log('DIFF_PATCH_SMOKE_OK');
