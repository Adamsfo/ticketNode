"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Evento = exports.EventoInit = void 0;
const sequelize_1 = require("sequelize");
const Produtor_1 = require("./Produtor");
var Status;
(function (Status) {
    Status["Disponivel"] = "Ativo";
    Status["Oculto"] = "Oculto";
    Status["Finalizado"] = "Finalizado";
})(Status || (Status = {}));
class Evento extends sequelize_1.Model {
    static initialize(sequelize) {
        Evento.init({
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
                type: sequelize_1.DataTypes.TEXT,
                allowNull: true
            },
            imagem: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            mapa: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            data_hora_inicio: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: false,
                get() {
                    const rawValue = this.getDataValue('data_hora_inicio');
                    return rawValue ? new Date(rawValue) : null;
                }
            },
            data_hora_fim: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: false,
                get() {
                    const rawValue = this.getDataValue('data_hora_fim');
                    return rawValue ? new Date(rawValue) : null;
                }
            },
            latitude: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            longitude: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            endereco: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            idUsuario: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false
            },
            idProdutor: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false
            },
            status: {
                type: sequelize_1.DataTypes.ENUM,
                values: ['Ativo', 'Oculto', 'Finalizado'],
                defaultValue: 'Oculto'
            }
        }, {
            sequelize,
            modelName: "Evento",
            freezeTableName: true,
        });
        // Define associations here if needed
        // For example:
        Evento.belongsTo(Produtor_1.Produtor, { foreignKey: 'idProdutor', as: 'Produtor' });
    }
}
exports.Evento = Evento;
const EventoInit = (sequelize) => {
    Evento.initialize(sequelize);
};
exports.EventoInit = EventoInit;
