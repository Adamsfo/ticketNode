"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TipoBloqueioSuite = exports.BloqueioSuite = exports.BloqueioSuiteInit = void 0;
const sequelize_1 = require("sequelize");
const EventoSuite_1 = require("./EventoSuite");
var TipoBloqueioSuite;
(function (TipoBloqueioSuite) {
    TipoBloqueioSuite["Manual"] = "Manual";
    TipoBloqueioSuite["Reserva"] = "Reserva";
})(TipoBloqueioSuite || (exports.TipoBloqueioSuite = TipoBloqueioSuite = {}));
class BloqueioSuite extends sequelize_1.Model {
    static initialize(sequelize) {
        BloqueioSuite.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            idEventoSuite: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'EventoSuite',
                    key: 'id',
                },
            },
            dataInicio: {
                type: sequelize_1.DataTypes.DATEONLY,
                allowNull: false,
            },
            dataFim: {
                type: sequelize_1.DataTypes.DATEONLY,
                allowNull: false,
            },
            tipo: {
                type: sequelize_1.DataTypes.ENUM(...Object.values(TipoBloqueioSuite)),
                allowNull: false,
            },
            idReservaSuite: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'ReservaSuite',
                    key: 'id',
                },
            },
            motivo: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true,
            },
            ativo: {
                type: sequelize_1.DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
            },
        }, {
            sequelize,
            modelName: 'BloqueioSuite',
            freezeTableName: true,
        });
    }
    static associate() {
        const { ReservaSuite } = require('./ReservaSuite');
        BloqueioSuite.belongsTo(EventoSuite_1.EventoSuite, {
            foreignKey: 'idEventoSuite',
            as: 'EventoSuite',
        });
        BloqueioSuite.belongsTo(ReservaSuite, {
            foreignKey: 'idReservaSuite',
            as: 'ReservaSuite',
        });
        ReservaSuite.hasMany(BloqueioSuite, {
            foreignKey: 'idReservaSuite',
            as: 'Bloqueios',
        });
    }
}
exports.BloqueioSuite = BloqueioSuite;
const BloqueioSuiteInit = (sequelize) => {
    BloqueioSuite.initialize(sequelize);
    BloqueioSuite.associate();
};
exports.BloqueioSuiteInit = BloqueioSuiteInit;
