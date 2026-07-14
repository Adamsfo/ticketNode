"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReservaHospedagem = exports.ReservaHospedagemInit = exports.StatusReservaHospedagem = void 0;
const sequelize_1 = require("sequelize");
const Evento_1 = require("./Evento");
const Usuario_1 = require("./Usuario");
const Transacao_1 = require("./Transacao");
var StatusReservaHospedagem;
(function (StatusReservaHospedagem) {
    StatusReservaHospedagem["AguardandoPagamento"] = "AguardandoPagamento";
    StatusReservaHospedagem["Confirmada"] = "Confirmada";
    StatusReservaHospedagem["Cancelada"] = "Cancelada";
    StatusReservaHospedagem["Expirada"] = "Expirada";
})(StatusReservaHospedagem || (exports.StatusReservaHospedagem = StatusReservaHospedagem = {}));
class ReservaHospedagem extends sequelize_1.Model {
    static initialize(sequelize) {
        ReservaHospedagem.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            idEvento: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: { model: Evento_1.Evento, key: 'id' },
            },
            idUsuario: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: { model: Usuario_1.Usuario, key: 'id' },
            },
            checkin: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: false,
            },
            checkout: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: false,
            },
            noites: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                validate: { isInt: true, min: 1 },
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
                type: sequelize_1.DataTypes.ENUM(...Object.values(StatusReservaHospedagem)),
                allowNull: false,
                defaultValue: StatusReservaHospedagem.AguardandoPagamento,
            },
            idTransacao: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true,
                references: { model: Transacao_1.Transacao, key: 'id' },
            },
            dataConfirmacao: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: true,
            },
        }, {
            sequelize,
            modelName: 'ReservaHospedagem',
            freezeTableName: true,
        });
    }
    static associate() {
        ReservaHospedagem.belongsTo(Evento_1.Evento, {
            foreignKey: 'idEvento',
            as: 'Evento',
        });
        ReservaHospedagem.belongsTo(Usuario_1.Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario',
        });
        ReservaHospedagem.belongsTo(Transacao_1.Transacao, {
            foreignKey: 'idTransacao',
            as: 'Transacao',
        });
    }
}
exports.ReservaHospedagem = ReservaHospedagem;
const ReservaHospedagemInit = (sequelize) => {
    ReservaHospedagem.initialize(sequelize);
    ReservaHospedagem.associate();
};
exports.ReservaHospedagemInit = ReservaHospedagemInit;
