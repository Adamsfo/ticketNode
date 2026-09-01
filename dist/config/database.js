"use strict";
require("dotenv").config();
const { sequelizeLogging, isSqlLogEnabled } = require("../utils/logger");
module.exports = {
    dialect: process.env.DB_DIALECT || "mysql",
    host: process.env.DB_HOST,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "ticketJango",
    timezone: process.env.DB_TIMEZONE || "+00:00",
    /** Padrão: silencioso. Ative com LOG_SQL=true */
    logging: isSqlLogEnabled() ? sequelizeLogging : false,
    define: {
        timestamps: true,
        underscored: true,
    },
};
