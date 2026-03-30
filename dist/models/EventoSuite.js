"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventoSuite = exports.EventoSuiteInit = void 0;
const sequelize_1 = require("sequelize");
const Evento_1 = require("./Evento");
const CupomPromocional_1 = require("./CupomPromocional");
var Status;
(function (Status) {
    Status["Disponivel"] = "Ativo";
    Status["Oculto"] = "Oculto";
})(Status || (Status = {}));
class EventoSuite extends sequelize_1.Model {
    static initialize(sequelize) {
        EventoSuite.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            nome: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            descricao: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            idEvento: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: Evento_1.Evento,
                    key: 'id'
                }
            },
            qtdeMinimaPessoas: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false
            },
            qtdeMaximaPessoas: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false
            },
            preco: {
                type: sequelize_1.DataTypes.DECIMAL(10, 2),
                allowNull: false
            },
            taxaServico: {
                type: sequelize_1.DataTypes.DECIMAL(10, 2),
                allowNull: false
            },
            valor: {
                type: sequelize_1.DataTypes.DECIMAL(10, 2),
                allowNull: false
            },
            status: {
                type: sequelize_1.DataTypes.ENUM,
                values: ['Ativo', 'Oculto', 'Finalizado', 'PDV'],
                defaultValue: 'Oculto'
            },
            idCupomPromocional: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: CupomPromocional_1.CupomPromocional,
                    key: 'id'
                }
            }
        }, {
            sequelize,
            modelName: 'EventoSuite',
            freezeTableName: true
        });
    }
    static associate() {
        EventoSuite.belongsTo(Evento_1.Evento, {
            foreignKey: 'idEvento',
            as: 'Evento'
        });
        EventoSuite.belongsTo(CupomPromocional_1.CupomPromocional, {
            foreignKey: 'idCupomPromocional',
            as: 'CupomPromocional'
        });
    }
}
exports.EventoSuite = EventoSuite;
const EventoSuiteInit = (sequelize) => {
    EventoSuite.initialize(sequelize);
    EventoSuite.associate();
};
exports.EventoSuiteInit = EventoSuiteInit;
