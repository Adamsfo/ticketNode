"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cidade = exports.CidadeInit = void 0;
const sequelize_1 = require("sequelize");
class Cidade extends sequelize_1.Model {
    static initialize(sequelize) {
        Cidade.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            descricao: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            uf: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false,
                validate: {
                    len: [2, 2]
                }
            }
        }, {
            sequelize,
            modelName: "Cidade",
            freezeTableName: true,
            timestamps: false,
            hooks: {
                beforeSave: (cidade) => {
                    if (cidade.uf) {
                        cidade.uf = cidade.uf.toUpperCase();
                    }
                }
            }
        });
    }
}
exports.Cidade = Cidade;
const CidadeInit = (sequelize) => {
    Cidade.initialize(sequelize);
};
exports.CidadeInit = CidadeInit;
