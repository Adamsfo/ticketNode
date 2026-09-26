"use strict";

/**
 * Índices para jobs/consultas por status em ReservaHospedagem:
 * - cancelarReservasExpiradas (OR em expira_em / created_at)
 * - listarReservasCandidatasCheckoutAutomatico (status + checkout)
 *
 * Sem alteração de lógica de aplicação.
 */

async function indexExists(queryInterface, tableName, indexName) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COUNT(*) AS c
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = :table
       AND index_name = :index`,
    { replacements: { table: tableName, index: indexName } }
  );
  return Number(rows[0].c) > 0;
}

const INDEXES = [
  {
    name: "idx_reserva_hosp_status_expira_em",
    fields: ["status", "expira_em"],
  },
  {
    name: "idx_reserva_hosp_status_created_at",
    fields: ["status", "created_at"],
  },
  {
    name: "idx_reserva_hosp_status_checkout",
    fields: ["status", "checkout"],
  },
];

module.exports = {
  async up(queryInterface) {
    for (const spec of INDEXES) {
      if (await indexExists(queryInterface, "ReservaHospedagem", spec.name)) {
        continue;
      }
      await queryInterface.addIndex("ReservaHospedagem", spec.fields, {
        name: spec.name,
      });
    }
  },

  async down(queryInterface) {
    for (const spec of INDEXES) {
      if (!(await indexExists(queryInterface, "ReservaHospedagem", spec.name))) {
        continue;
      }
      await queryInterface.removeIndex("ReservaHospedagem", spec.name);
    }
  },
};
