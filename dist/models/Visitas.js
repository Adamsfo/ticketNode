"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Visitas = exports.VisitasInit = void 0;
const sequelize_1 = require("sequelize");
class Visitas extends sequelize_1.Model {
    static initialize(sequelize) {
        Visitas.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            quantidade: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                validate: {
                    isInt: true,
                    min: 0
                }
            }
        }, {
            sequelize,
            modelName: "Visitas",
            freezeTableName: true,
        });
    }
}
exports.Visitas = Visitas;
const VisitasInit = (sequelize) => {
    Visitas.initialize(sequelize);
};
exports.VisitasInit = VisitasInit;
