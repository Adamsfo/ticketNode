"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsuarioMetodoPagamento = exports.UsuarioMetodoPagamentoInit = void 0;
const sequelize_1 = require("sequelize");
class UsuarioMetodoPagamento extends sequelize_1.Model {
    static initialize(sequelize) {
        UsuarioMetodoPagamento.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idUsuario: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Usuario', // Nome da tabela referenciada
                    key: 'id' // Chave primária da tabela referenciada
                },
            },
            dados: {
                type: sequelize_1.DataTypes.TEXT,
                allowNull: false
            }
        }, {
            sequelize,
            modelName: "UsuarioMetodoPagamento",
            freezeTableName: true,
        });
    }
}
exports.UsuarioMetodoPagamento = UsuarioMetodoPagamento;
const UsuarioMetodoPagamentoInit = (sequelize) => {
    UsuarioMetodoPagamento.initialize(sequelize);
};
exports.UsuarioMetodoPagamentoInit = UsuarioMetodoPagamentoInit;
