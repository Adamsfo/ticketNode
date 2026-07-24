"use strict";
require("dotenv").config();
module.exports = {
    dialect: process.env.DB_DIALECT || "mysql",
    host: process.env.DB_HOST,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "ticketJango",
    timezone: process.env.DB_TIMEZONE || "+00:00",
    define: {
        timestamps: true,
        underscored: true,
    },
};
