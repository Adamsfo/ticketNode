"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TipoDesconto = exports.CupomPromocionalValidade = exports.CupomPromocional = exports.CupomPromocionalInit = void 0;
const sequelize_1 = require("sequelize");
const Produtor_1 = require("./Produtor");
const EventoIngresso_1 = require("./EventoIngresso");
var TipoDesconto;
(function (TipoDesconto) {
    TipoDesconto["Nenhum"] = "Nenhum";
    TipoDesconto["Percentual"] = "Percentual";
    TipoDesconto["Fixo"] = "Fixo";
})(TipoDesconto || (exports.TipoDesconto = TipoDesconto = {}));
class CupomPromocional extends sequelize_1.Model {
    static initialize(sequelize) {
        CupomPromocional.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            nome: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            idProdutor: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false
            },
            tipoDesconto: {
                type: sequelize_1.DataTypes.ENUM,
                values: Object.values(TipoDesconto),
                allowNull: false,
                defaultValue: TipoDesconto.Percentual // Valor padrão
            },
            valorDesconto: {
                type: sequelize_1.DataTypes.FLOAT,
                allowNull: false,
                defaultValue: 0 // Valor padrão
            },
            valorDescontoTaxa: {
                type: sequelize_1.DataTypes.FLOAT,
                allowNull: true, // Pode ser nulo se não houver desconto na taxa
                defaultValue: 0 // Valor padrão
            }
        }, {
            sequelize,
            modelName: "CupomPromocional",
            freezeTableName: true,
        });
    }
    static associate(models) {
        CupomPromocional.belongsTo(models.Produtor, {
            foreignKey: 'idProdutor',
            as: 'Produtor'
        });
        CupomPromocional.hasMany(models.CupomPromocionalValidade, {
            foreignKey: 'idCupomPromocional',
            as: 'CupomPromocionalValidade'
        });
        // CupomPromocional.hasMany(models.Ingresso, {
        //     foreignKey: 'idCupomPromocional',
        //     as: 'EventoIngresso'
        // });
    }
}
exports.CupomPromocional = CupomPromocional;
class CupomPromocionalValidade extends sequelize_1.Model {
    static initialize(sequelize) {
        CupomPromocionalValidade.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idCupomPromocional: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false
            },
            dataInicial: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: false
            },
            dataFinal: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: false
            }
        }, {
            sequelize,
            modelName: "CupomPromocionalValidade",
            freezeTableName: true,
        });
    }
    static associate(models) {
        CupomPromocionalValidade.belongsTo(models.CupomPromocional, {
            foreignKey: 'idCupomPromocional',
            as: 'CupomPromocional'
        });
    }
}
exports.CupomPromocionalValidade = CupomPromocionalValidade;
const CupomPromocionalInit = (sequelize) => {
    CupomPromocional.initialize(sequelize);
    CupomPromocionalValidade.initialize(sequelize);
    CupomPromocional.associate({ Produtor: Produtor_1.Produtor, CupomPromocionalValidade, EventoIngresso: EventoIngresso_1.EventoIngresso });
    CupomPromocionalValidade.associate({ CupomPromocional });
};
exports.CupomPromocionalInit = CupomPromocionalInit;
