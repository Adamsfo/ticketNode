"use strict";

/**
 * UNIQUE (provider, entity_type, external_id) — lookup de identidade em
 * IntegrationSyncStateService.findByIdentity e todo o pipeline Hospedin.
 *
 * Alinha com scripts/create-integration-sync-state.sql (uq_integration_sync_identity).
 * Falha na criação se houver duplicatas — revisar antes em produção.
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

const TABLE = "integration_sync_state";
const INDEX_NAME = "uq_integration_sync_identity";

module.exports = {
  async up(queryInterface) {
    if (await indexExists(queryInterface, TABLE, INDEX_NAME)) {
      return;
    }

    const [dups] = await queryInterface.sequelize.query(
      `SELECT provider, entity_type, external_id, COUNT(*) AS c
       FROM integration_sync_state
       GROUP BY provider, entity_type, external_id
       HAVING c > 1
       LIMIT 5`
    );
    if (dups.length > 0) {
      throw new Error(
        `Não é possível criar ${INDEX_NAME}: existem duplicatas em integration_sync_state (provider, entity_type, external_id).`
      );
    }

    await queryInterface.addIndex(TABLE, ["provider", "entity_type", "external_id"], {
      name: INDEX_NAME,
      unique: true,
    });
  },

  async down(queryInterface) {
    if (!(await indexExists(queryInterface, TABLE, INDEX_NAME))) {
      return;
    }
    await queryInterface.removeIndex(TABLE, INDEX_NAME);
  },
};
