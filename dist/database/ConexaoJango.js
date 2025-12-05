"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = query;
const util_1 = __importDefault(require("util"));
const databaseJango_1 = require("../config/databaseJango");
async function query(sql, params) {
    const db = await (0, databaseJango_1.connect)();
    try {
        const exec = util_1.default.promisify(db.query).bind(db);
        const result = (await exec(sql, params ?? []));
        return result;
    }
    finally {
        db.detach();
    }
}
