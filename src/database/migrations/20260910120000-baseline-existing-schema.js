"use strict";

/**
 * Baseline do schema existente antes da adoção de Sequelize Migrations.
 *
 * O schema de DEV e PRODUÇÃO já estava criado via sync histórico e scripts SQL
 * versionados. Esta migration é intencionalmente um NO-OP: não executa DDL.
 *
 * Após autorização, registrar nos bancos existentes via SequelizeMeta (ver docs/plano
 * de baseline) sem recriar tabelas.
 */
module.exports = {
  async up() {},

  async down() {
    throw new Error("Baseline cannot be reverted");
  },
};
