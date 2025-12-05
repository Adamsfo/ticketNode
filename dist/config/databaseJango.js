"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connect = connect;
const node_firebird_1 = __importDefault(require("node-firebird"));
const options = {
    host: '160.20.20.102',
    port: 3050,
    database: 'C:\\PDV\\Server\\PDV.FDB',
    user: 'SYSDBA',
    password: 'masterkey',
    lowercase_keys: false,
    // role: null,
    pageSize: 4096
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
