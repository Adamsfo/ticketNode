"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TipoAcesso = exports.ProdutorAcesso = exports.Produtor = exports.ProdutorInit = void 0;
const sequelize_1 = require("sequelize");
const Usuario_1 = require("./Usuario");
class Produtor extends sequelize_1.Model {
    static initialize(sequelize) {
        Produtor.init({
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
            logo: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            }
        }, {
            sequelize,
            modelName: "Produtor",
            freezeTableName: true,
        });
    }
}
exports.Produtor = Produtor;
var TipoAcesso;
(function (TipoAcesso) {
    TipoAcesso["Administrador"] = "Administrador";
    TipoAcesso["Validador"] = "Validador";
    TipoAcesso["PDV"] = "PDV";
})(TipoAcesso || (exports.TipoAcesso = TipoAcesso = {}));
class ProdutorAcesso extends sequelize_1.Model {
    static initialize(sequelize) {
        ProdutorAcesso.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idProdutor: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false
            },
            tipoAcesso: {
                type: sequelize_1.DataTypes.ENUM(...Object.values(TipoAcesso)),
                allowNull: false
            },
            idUsuario: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false
            },
            cliente_chavePOS: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            pos_id: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true
            }
        }, {
            sequelize,
            modelName: "ProdutorAcesso",
            freezeTableName: true,
        });
    }
    static associate(models) {
        ProdutorAcesso.belongsTo(models.Produtor, {
            foreignKey: 'idProdutor',
            as: 'Produtor'
        });
        ProdutorAcesso.belongsTo(models.Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario'
        });
    }
}
exports.ProdutorAcesso = ProdutorAcesso;
const ProdutorInit = (sequelize) => {
    Produtor.initialize(sequelize);
    ProdutorAcesso.initialize(sequelize);
    ProdutorAcesso.associate({ Produtor, Usuario: Usuario_1.Usuario });
};
exports.ProdutorInit = ProdutorInit;
