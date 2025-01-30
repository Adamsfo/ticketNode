"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Empresa = exports.EmpresaInit = void 0;
const sequelize_1 = require("sequelize");
class Empresa extends sequelize_1.Model {
    static initialize(sequelize) {
        Empresa.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            nomeFantasia: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            razaoSocial: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            cnpj: {
                type: sequelize_1.DataTypes.STRING,
                unique: true,
                allowNull: false,
                validate: {
                    is: /^\d{14}$/
                }
            },
            inscricaoEstadual: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            inscricaoMunicipal: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            dataInicioAtividades: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: false
            },
            cep: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false,
                validate: {
                    is: /^\d{8}$/
                }
            },
            endereco: sequelize_1.DataTypes.STRING,
            numero: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            complemento: sequelize_1.DataTypes.STRING,
            bairro: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            idCidade: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'Cidade',
                    key: 'id'
                }
            },
            logradouro: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            telefone: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false,
                validate: {
                    is: /^\d{10,11}$/
                }
            },
            ultimoNumeroNFe: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true,
                defaultValue: 0
            },
            ultimoNumeroNFCe: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true,
                defaultValue: 0
            },
            numeroSerieNFe: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true
            },
            numeroSerieNFCe: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true
            },
            ambienteNFe: {
                type: sequelize_1.DataTypes.ENUM('Produção', 'Homologação'),
                allowNull: false
            },
            regimeTributario: {
                type: sequelize_1.DataTypes.ENUM('Simples Nacional', 'Regime Normal'),
                allowNull: false
            },
            tipo: {
                type: sequelize_1.DataTypes.ENUM('principal', 'filial'),
                allowNull: false
            },
            CSCID: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            CSC: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            }
        }, {
            sequelize,
            modelName: "Empresa",
            freezeTableName: true
        });
    }
    static associate(models) {
        Empresa.belongsTo(models.Cidade, {
            foreignKey: 'idCidade',
            as: 'cidade'
        });
    }
}
exports.Empresa = Empresa;
const EmpresaInit = (sequelize) => {
    Empresa.initialize(sequelize);
};
exports.EmpresaInit = EmpresaInit;
