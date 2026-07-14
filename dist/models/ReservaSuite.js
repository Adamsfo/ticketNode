"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReservaSuite = exports.ReservaSuiteInit = exports.StatusReservaSuite = void 0;
const sequelize_1 = require("sequelize");
const EventoSuite_1 = require("./EventoSuite");
const ReservaHospedagem_1 = require("./ReservaHospedagem");
var StatusReservaSuite;
(function (StatusReservaSuite) {
    StatusReservaSuite["AguardandoPagamento"] = "AguardandoPagamento";
    StatusReservaSuite["Confirmada"] = "Confirmada";
    StatusReservaSuite["Cancelada"] = "Cancelada";
    StatusReservaSuite["Expirada"] = "Expirada";
})(StatusReservaSuite || (exports.StatusReservaSuite = StatusReservaSuite = {}));
class ReservaSuite extends sequelize_1.Model {
    static initialize(sequelize) {
        ReservaSuite.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            idReservaHospedagem: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'ReservaHospedagem',
                    key: 'id',
                },
            },
            idEventoSuite: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'EventoSuite',
                    key: 'id',
                },
            },
            adultos: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                validate: {
                    isInt: true,
                    min: 1,
                },
            },
            criancas: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                validate: {
                    isInt: true,
                    min: 0,
                },
            },
            preco: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: false,
            },
            taxaServico: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: false,
            },
            valorTotal: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: false,
            },
            status: {
                type: sequelize_1.DataTypes.ENUM(...Object.values(StatusReservaSuite)),
                allowNull: false,
                defaultValue: StatusReservaSuite.AguardandoPagamento,
            },
        }, {
            sequelize,
            modelName: 'ReservaSuite',
            freezeTableName: true,
        });
    }
    static associate() {
        ReservaSuite.belongsTo(ReservaHospedagem_1.ReservaHospedagem, {
            foreignKey: 'idReservaHospedagem',
            as: 'ReservaHospedagem',
        });
        ReservaSuite.belongsTo(EventoSuite_1.EventoSuite, {
            foreignKey: 'idEventoSuite',
            as: 'EventoSuite',
        });
        ReservaHospedagem_1.ReservaHospedagem.hasMany(ReservaSuite, {
            foreignKey: 'idReservaHospedagem',
            as: 'ReservaSuite',
        });
    }
}
exports.ReservaSuite = ReservaSuite;
const ReservaSuiteInit = (sequelize) => {
    ReservaSuite.initialize(sequelize);
    ReservaSuite.associate();
};
exports.ReservaSuiteInit = ReservaSuiteInit;
