"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventoIngresso = exports.EventoIngressoInit = void 0;
const sequelize_1 = require("sequelize");
const TipoIngresso_1 = require("./TipoIngresso");
const Evento_1 = require("./Evento");
const CupomPromocional_1 = require("./CupomPromocional");
var Status;
(function (Status) {
    Status["Disponivel"] = "Ativo";
    Status["Oculto"] = "Oculto";
    Status["Finalizado"] = "Finalizado";
})(Status || (Status = {}));
class EventoIngresso extends sequelize_1.Model {
    static initialize(sequelize) {
        EventoIngresso.init({
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
            idTipoIngresso: {
                type: sequelize_1.DataTypes.INTEGER,
                references: {
                    model: TipoIngresso_1.TipoIngresso,
                    key: 'id'
                }
            },
            idEvento: {
                type: sequelize_1.DataTypes.INTEGER,
                references: {
                    model: Evento_1.Evento,
                    key: 'id'
                }
            },
            qtde: {
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
            lote: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            status: {
                type: sequelize_1.DataTypes.ENUM,
                values: ['Ativo', 'Oculto', 'Finalizado'],
                defaultValue: 'Oculto'
            },
            idCupomPromocional: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: CupomPromocional_1.CupomPromocional, // Assuming you have a CupomPromocional model
                    key: 'id'
                }
            }
        }, {
            sequelize,
            modelName: "EventoIngresso",
            freezeTableName: true,
        });
    }
    static associate() {
        EventoIngresso.belongsTo(TipoIngresso_1.TipoIngresso, {
            foreignKey: 'idTipoIngresso',
            as: 'TipoIngresso'
        });
        EventoIngresso.belongsTo(Evento_1.Evento, {
            foreignKey: 'idEvento',
            as: 'Evento'
        });
        EventoIngresso.belongsTo(CupomPromocional_1.CupomPromocional, {
            foreignKey: 'idCupomPromocional',
            as: 'CupomPromocional'
        });
        // EventoIngresso.hasMany(Ingresso, {
        //     foreignKey: 'idEvento',
        //     as: 'Ingresso'
        // });
    }
}
exports.EventoIngresso = EventoIngresso;
const EventoIngressoInit = (sequelize) => {
    EventoIngresso.initialize(sequelize);
    EventoIngresso.associate();
};
exports.EventoIngressoInit = EventoIngressoInit;
