"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Endereco = exports.ClienteFornecedor = exports.ClienteFornecedorInit = void 0;
const sequelize_1 = require("sequelize");
const Cidade_1 = require("./Cidade");
const Empresa_1 = require("./Empresa");
class ClienteFornecedor extends sequelize_1.Model {
    static initialize(sequelize) {
        ClienteFornecedor.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            tipo: {
                type: sequelize_1.DataTypes.ENUM('Cliente', 'Fornecedor'),
                allowNull: false
            },
            cnpjCpf: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false,
                // unique: true
            },
            insEstadual: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            insMunicipal: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            razaoSocialNome: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            nomeFantasia: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            consumidorFinal: {
                type: sequelize_1.DataTypes.ENUM('Sim', 'Não'),
                allowNull: false
            },
            contribuinte: {
                type: sequelize_1.DataTypes.ENUM('Sim', 'Não'),
                allowNull: false
            },
            cnae: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            email: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            telefoneFixo: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            telefoneCelular: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            telefoneAlternativo: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            telefoneWhatsApp: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            dataNascimento: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: true
            },
            sexo: {
                type: sequelize_1.DataTypes.ENUM('Masculino', 'Feminino'),
                allowNull: true
            },
            nacionalidade: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            tipoDocumento: {
                type: sequelize_1.DataTypes.ENUM('RG', 'CPF', 'CNPJ', 'Passaporte', 'Outro'),
                allowNull: true
            },
            limiteCredito: {
                type: sequelize_1.DataTypes.DECIMAL(10, 2),
                allowNull: true
            },
            observacao: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            empresaId: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: Empresa_1.Empresa,
                    key: 'id'
                }
            }
        }, {
            sequelize,
            modelName: "ClienteFornecedor",
            freezeTableName: true
        });
    }
    static associate(models) {
        ClienteFornecedor.belongsTo(models.Empresa, {
            foreignKey: 'empresaId',
            as: 'empresa',
        });
    }
}
exports.ClienteFornecedor = ClienteFornecedor;
class Endereco extends sequelize_1.Model {
    static initialize(sequelize) {
        Endereco.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            clienteFornecedorId: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: ClienteFornecedor,
                    key: 'id'
                }
            },
            tipoEndereco: {
                type: sequelize_1.DataTypes.ENUM('Residencial', 'Comercial', 'Cobrança', 'Inscrição'),
                allowNull: false
            },
            rua: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            uf: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            cidadeId: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: Cidade_1.Cidade,
                    key: 'id'
                }
            },
            numero: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            bairro: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            cep: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            inscricaoEstadual: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            complemento: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            },
            observacao: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            nomeCidade: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            }
        }, {
            sequelize,
            modelName: "Endereco",
            freezeTableName: true
        });
    }
    static associate() {
        Endereco.belongsTo(ClienteFornecedor, {
            foreignKey: 'clienteFornecedorId',
            as: 'clienteFornecedor'
        });
        Endereco.belongsTo(Cidade_1.Cidade, {
            foreignKey: 'cidadeId',
            as: 'cidade'
        });
    }
}
exports.Endereco = Endereco;
const ClienteFornecedorInit = (sequelize) => {
    ClienteFornecedor.initialize(sequelize);
    ClienteFornecedor.associate({ Empresa: Empresa_1.Empresa });
    Endereco.initialize(sequelize);
    Endereco.associate();
};
exports.ClienteFornecedorInit = ClienteFornecedorInit;
