/**
 * Smoke GuestResolver + CPF (sem Hospedin API).
 * node scripts/_homolog-guest-resolver-smoke.js
 */
require('dotenv').config();
require('ts-node/register/transpile-only');

(async () => {
  require('../src/database');
  await new Promise((r) => setTimeout(r, 1500));

  const {
    guestResolverService,
    HOSPEDIN_TECHNICAL_USERS,
  } = require('../src/services/GuestResolverService');
  const { TipoReservaHospede } = require('../src/models/ReservaHospede');
  const { Usuario } = require('../src/models/Usuario');

  function assert(c, m) {
    if (!c) throw new Error(m);
  }

  guestResolverService.clearCache();
  const tech = await guestResolverService.ensureTechnicalUsers();
  console.log('technical', tech);

  const missingUser = await Usuario.findByPk(tech.missingId);
  const invalidUser = await Usuario.findByPk(tech.invalidId);
  assert(missingUser?.login === HOSPEDIN_TECHNICAL_USERS.CPF_MISSING.login, 'missing login');
  assert(invalidUser?.login === HOSPEDIN_TECHNICAL_USERS.CPF_INVALID.login, 'invalid login');
  assert(missingUser?.cpf == null, 'missing cpf null');
  assert(invalidUser?.cpf == null, 'invalid cpf null');
  assert(tech.missingId !== tech.invalidId, 'distinct technical users');

  const c = await guestResolverService.resolveGuest({
    nome: 'Lilian Sem Cpf',
    tipo: TipoReservaHospede.Adulto,
    cpf: null,
  });
  console.log('missing', c.action, c.idUsuario);
  assert(c.action === 'TECHNICAL_CPF_MISSING', 'missing action');
  assert(c.idUsuario === tech.missingId, 'missing id');

  const c2 = await guestResolverService.resolveGuest({
    nome: 'Outro Sem Cpf',
    tipo: TipoReservaHospede.Adulto,
    cpf: null,
  });
  assert(c2.idUsuario === tech.missingId, 'reuse missing');

  const d = await guestResolverService.resolveGuest({
    nome: 'CPF Ruim',
    tipo: TipoReservaHospede.Adulto,
    cpf: '123.456.789-00',
  });
  console.log('invalid', d.action, d.idUsuario);
  assert(d.action === 'TECHNICAL_CPF_INVALID', 'invalid action');
  assert(d.idUsuario === tech.invalidId, 'invalid id');

  const cpf = '529.982.247-25';
  const a = await guestResolverService.resolveGuest({
    nome: 'Smoke Test Alpha',
    tipo: TipoReservaHospede.Adulto,
    cpf,
    previousIdUsuario: tech.missingId,
  }, { previousIdUsuario: tech.missingId });
  console.log('upgrade', a.action, a.idUsuario);
  assert(
    a.action === 'UPGRADED_FROM_TECHNICAL' ||
      a.action === 'CREATED' ||
      a.action === 'REUSED_BY_CPF',
    'valid cpf'
  );
  assert(a.idUsuario !== tech.missingId, 'not technical after cpf');

  const b = await guestResolverService.resolveGuest({
    nome: 'Mesmo CPF',
    tipo: TipoReservaHospede.Adulto,
    cpf,
  });
  assert(b.idUsuario === a.idUsuario, 'same real user');

  console.log('GUEST_RESOLVER_SMOKE_OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
