"use strict";

/**
 * Corrige nullable de id_reserva_hospedagem e id_reserva_suite em EventoSuiteLimpeza.
 *
 * A migration 20260913130000 criou origem corretamente, mas changeColumn com
 * references não alterou NULL no MySQL (FKs fk_limpeza_reserva_* permanecem).
 * Usa MODIFY COLUMN explícito — equivalente a scripts/alter-evento-suite-limpeza-manual.sql.
 *
 * Não altera: origem, status, UNIQUE uq_limpeza_reserva_suite, nem dados existentes.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE EventoSuiteLimpeza
        MODIFY COLUMN id_reserva_hospedagem INT NULL,
        MODIFY COLUMN id_reserva_suite INT NULL
    `);
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(`
      SELECT COUNT(*) AS total
      FROM EventoSuiteLimpeza
      WHERE origem = 'MANUAL'
         OR id_reserva_hospedagem IS NULL
         OR id_reserva_suite IS NULL
    `);

    const total = Number(rows?.[0]?.total ?? 0);
    if (total > 0) {
      throw new Error(
        "Não é possível reverter: existem limpezas MANUAL ou sem vínculo de reserva."
      );
    }

    await queryInterface.sequelize.query(`
      ALTER TABLE EventoSuiteLimpeza
        MODIFY COLUMN id_reserva_hospedagem INT NOT NULL,
        MODIFY COLUMN id_reserva_suite INT NOT NULL
    `);
  },
};
