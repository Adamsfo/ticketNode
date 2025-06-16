"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TipoIngresso = exports.TipoIngressoInit = void 0;
const sequelize_1 = require("sequelize");
class TipoIngresso extends sequelize_1.Model {
    static initialize(sequelize) {
        TipoIngresso.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            descricao: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            qtde: {
                type: sequelize_1.DataTypes.INTEGER
            }
        }, {
            sequelize,
            modelName: "TipoIngresso",
            freezeTableName: true,
        });
    }
}
exports.TipoIngresso = TipoIngresso;
const TipoIngressoInit = (sequelize) => {
    TipoIngresso.initialize(sequelize);
};
exports.TipoIngressoInit = TipoIngressoInit;
