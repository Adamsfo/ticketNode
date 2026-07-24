"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connect = connect;
require("dotenv/config");
const node_firebird_1 = __importDefault(require("node-firebird"));
const options = {
    host: process.env.JANGO_FB_HOST,
    port: Number(process.env.JANGO_FB_PORT || 3050),
    database: process.env.JANGO_FB_DATABASE,
    user: process.env.JANGO_FB_USER,
    password: process.env.JANGO_FB_PASSWORD,
    lowercase_keys: false,
    pageSize: 4096,
};
function connect() {
    return new Promise((resolve, reject) => {
        node_firebird_1.default.attach(options, (err, db) => {
            if (err)
                reject(err);
            else
                resolve(db);
        });
    });
}
