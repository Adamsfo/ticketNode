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
    StatusReservaHospedagem["Hospedada"] = "Hospedada";
    StatusReservaHospedagem["CheckOutRealizado"] = "CheckOutRealizado";
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
            valorPago: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: false,
                defaultValue: 0,
            },
            saldoPendente: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: true,
            },
            formaPagamentoRecepcao: {
                type: sequelize_1.DataTypes.STRING(40),
                allowNull: true,
            },
            observacaoPagamento: {
                type: sequelize_1.DataTypes.TEXT,
                allowNull: true,
            },
            comprovantePagamento: {
                type: sequelize_1.DataTypes.STRING(255),
                allowNull: true,
            },
            origemReserva: {
                // VARCHAR no banco (produção já tem CLIENTE/ATENDENTE).
                // Evita ENUM para não exigir ALTER ao incluir novas origens.
                type: sequelize_1.DataTypes.STRING(30),
                allowNull: false,
                defaultValue: 'CLIENTE',
            },
            idExterno: {
                type: sequelize_1.DataTypes.STRING(64),
                allowNull: true,
            },
            codigoExterno: {
                type: sequelize_1.DataTypes.STRING(64),
                allowNull: true,
            },
            canalVenda: {
                type: sequelize_1.DataTypes.STRING(40),
                allowNull: true,
            },
            possivelPagamentoOta: {
                type: sequelize_1.DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            possivelPagamentoOtaTrecho: {
                type: sequelize_1.DataTypes.TEXT,
                allowNull: true,
            },
            idUsuarioCriacao: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true,
                references: { model: Usuario_1.Usuario, key: 'id' },
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
            tokenPagamento: {
                type: sequelize_1.DataTypes.STRING(64),
                allowNull: true,
                unique: true,
            },
            expiraEm: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: true,
            },
            linkPagamentoEnviadoEm: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: true,
            },
            dataConfirmacao: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: true,
            },
            dataHoraCheckinReal: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: true,
            },
            idUsuarioCheckin: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true,
                references: { model: Usuario_1.Usuario, key: 'id' },
            },
            dataHoraCheckoutRealizado: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: true,
            },
            idUsuarioCheckout: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true,
                references: { model: Usuario_1.Usuario, key: 'id' },
            },
            observacoes: {
                type: sequelize_1.DataTypes.TEXT,
                allowNull: true,
            },
            observacaoImportada: {
                type: sequelize_1.DataTypes.TEXT,
                allowNull: true,
            },
            observacaoOperador: {
                type: sequelize_1.DataTypes.TEXT,
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
        ReservaHospedagem.belongsTo(Usuario_1.Usuario, {
            foreignKey: 'idUsuarioCheckin',
            as: 'UsuarioCheckin',
        });
        ReservaHospedagem.belongsTo(Usuario_1.Usuario, {
            foreignKey: 'idUsuarioCheckout',
            as: 'UsuarioCheckout',
        });
        ReservaHospedagem.belongsTo(Usuario_1.Usuario, {
            foreignKey: 'idUsuarioCriacao',
            as: 'UsuarioCriacao',
        });
    }
}
exports.ReservaHospedagem = ReservaHospedagem;
const ReservaHospedagemInit = (sequelize) => {
    ReservaHospedagem.initialize(sequelize);
    ReservaHospedagem.associate();
};
exports.ReservaHospedagemInit = ReservaHospedagemInit;
