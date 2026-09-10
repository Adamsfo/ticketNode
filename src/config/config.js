require("dotenv").config();

/**
 * Configuração do Sequelize CLI (db:migrate, db:migrate:status, db:migrate:undo).
 * Espelha ticket-node/src/config/database.ts e usa as mesmas variáveis de ambiente.
 *
 * Nota: não importa logger.ts (TypeScript); replica apenas a flag LOG_SQL aqui.
 */
function isSqlLogEnabled() {
  const v = String(process.env.LOG_SQL ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function buildConfig() {
  return {
    dialect: process.env.DB_DIALECT || "mysql",
    host: process.env.DB_HOST,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "ticketJango",
    timezone: process.env.DB_TIMEZONE || "+00:00",
    logging: isSqlLogEnabled() ? console.log : false,
    define: {
      timestamps: true,
      underscored: true,
    },
  };
}

module.exports = {
  development: buildConfig(),
  test: buildConfig(),
  production: buildConfig(),
};
