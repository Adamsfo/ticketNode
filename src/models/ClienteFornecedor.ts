import { Model, DataTypes, Optional, Sequelize } from 'sequelize';
import { Cidade } from './Cidade';
import { Empresa } from './Empresa';

interface ClienteFornecedorAttributes {
    id: number;
    tipo: 'Cliente' | 'Fornecedor'
    cnpjCpf: string;
    insEstadual?: string;
    insMunicipal?: string;
    razaoSocialNome?: string;
    nomeFantasia?: string;
    consumidorFinal: 'Sim' | 'Não'
    contribuinte: 'Sim' | 'Não'
    cnae?: string;
    email?: string;
    telefoneFixo?: string;
    telefoneCelular?: string;
    telefoneAlternativo?: string;
    telefoneWhatsApp?: string;
    dataNascimento?: Date;
    sexo?: 'Masculino' | 'Feminino';
    nacionalidade?: string;
    tipoDocumento?: 'RG' | 'CPF' | 'CNPJ' | 'Passaporte' | 'Outro';
    limiteCredito?: number;
    observacao?: string;
    empresaId: number;
}

interface ClienteFornecedorCreationAttributes extends Optional<ClienteFornecedorAttributes, 'id'> { }

class ClienteFornecedor extends Model<ClienteFornecedorAttributes, ClienteFornecedorCreationAttributes> implements ClienteFornecedorAttributes {
    public id!: number;
    public tipo!: 'Cliente' | 'Fornecedor'
    public cnpjCpf!: string;
    public insEstadual!: string;
    public insMunicipal!: string;
    public razaoSocialNome?: string;
    public nomeFantasia!: string;
    public consumidorFinal!: 'Sim' | 'Não'
    public contribuinte!: 'Sim' | 'Não'
    public cnae!: string;
    public email!: string;
    public telefoneFixo!: string;
    public telefoneCelular!: string;
    public telefoneAlternativo!: string;
    public telefoneWhatsApp!: string;
    public dataNascimento!: Date;
    public sexo!: 'Masculino' | 'Feminino';
    public nacionalidade!: string;
    public tipoDocumento!: 'RG' | 'CPF' | 'CNPJ' | 'Passaporte' | 'Outro';
    public limiteCredito!: number;
    public observacao!: string;
    public empresaId!: number;

    static initialize(sequelize: Sequelize) {
        ClienteFornecedor.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            tipo: {
                type: DataTypes.ENUM('Cliente', 'Fornecedor'),
                allowNull: false
            },
            cnpjCpf: {
                type: DataTypes.STRING,
                allowNull: false,
                // unique: true
            },
            insEstadual: {
                type: DataTypes.STRING,
                allowNull: true
            },
            insMunicipal: {
                type: DataTypes.STRING,
                allowNull: true
            },
            razaoSocialNome: {
                type: DataTypes.STRING,
                allowNull: true
            },
            nomeFantasia: {
                type: DataTypes.STRING,
                allowNull: true
            },
            consumidorFinal: {
                type: DataTypes.ENUM('Sim', 'Não'),
                allowNull: false
            },
            contribuinte: {
                type: DataTypes.ENUM('Sim', 'Não'),
                allowNull: false
            },
            cnae: {
                type: DataTypes.STRING,
                allowNull: true
            },
            email: {
                type: DataTypes.STRING,
                allowNull: true
            },
            telefoneFixo: {
                type: DataTypes.STRING,
                allowNull: true
            },
            telefoneCelular: {
                type: DataTypes.STRING,
                allowNull: true
            },
            telefoneAlternativo: {
                type: DataTypes.STRING,
                allowNull: true
            },
            telefoneWhatsApp: {
                type: DataTypes.STRING,
                allowNull: true
            },
            dataNascimento: {
                type: DataTypes.DATE,
                allowNull: true
            },
            sexo: {
                type: DataTypes.ENUM('Masculino', 'Feminino'),
                allowNull: true
            },
            nacionalidade: {
                type: DataTypes.STRING,
                allowNull: true
            },
            tipoDocumento: {
                type: DataTypes.ENUM('RG', 'CPF', 'CNPJ', 'Passaporte', 'Outro'),
                allowNull: true
            },
            limiteCredito: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: true
            },
            observacao: {
                type: DataTypes.STRING,
                allowNull: true
            },
            empresaId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: Empresa,
                    key: 'id'
                }
            }
        }, {
            sequelize,
            modelName: "ClienteFornecedor",
            freezeTableName: true
        });
    }

    public static associate(models: any) {
        ClienteFornecedor.belongsTo(models.Empresa, {
            foreignKey: 'empresaId',
            as: 'empresa',
        });
    }
}

interface EnderecoAttributes {
    id: number;
    clienteFornecedorId: number;
    tipoEndereco: 'Residencial' | 'Comercial' | 'Cobrança' | 'Inscrição';
    rua: string;
    uf: string;
    cidadeId: number;
    numero?: string;
    bairro: string;
    cep: string;
    inscricaoEstadual?: string;
    complemento?: string;
    observacao?: string;
    nomeCidade?: string;
}

interface EnderecoCreationAttributes extends Optional<EnderecoAttributes, 'id'> { }

class Endereco extends Model<EnderecoAttributes, EnderecoCreationAttributes> implements EnderecoAttributes {
    public id!: number;
    clienteFornecedorId!: number;
    public tipoEndereco!: 'Residencial' | 'Comercial' | 'Cobrança' | 'Inscrição';
    public rua!: string;
    public uf!: string;
    public cidadeId!: number;
    public numero!: string;
    public bairro!: string;
    public cep!: string;
    public inscricaoEstadual!: string;
    public complemento!: string;
    public observacao!: string;
    public nomeCidade!: string;

    static initialize(sequelize: Sequelize) {
        Endereco.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            clienteFornecedorId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: ClienteFornecedor,
                    key: 'id'
                }
            },
            tipoEndereco: {
                type: DataTypes.ENUM('Residencial', 'Comercial', 'Cobrança', 'Inscrição'),
                allowNull: false
            },
            rua: {
                type: DataTypes.STRING,
                allowNull: false
            },
            uf: {
                type: DataTypes.STRING,
                allowNull: false
            },
            cidadeId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: Cidade,
                    key: 'id'
                }
            },
            numero: {
                type: DataTypes.STRING,
                allowNull: true
            },
            bairro: {
                type: DataTypes.STRING,
                allowNull: false
            },
            cep: {
                type: DataTypes.STRING,
                allowNull: false
            },
            inscricaoEstadual: {
                type: DataTypes.STRING,
                allowNull: true
            },
            complemento: {
                type: DataTypes.STRING,
                allowNull: false
            },
            observacao: {
                type: DataTypes.STRING,
                allowNull: true
            },
            nomeCidade: {
                type: DataTypes.STRING,
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
        Endereco.belongsTo(Cidade, {
            foreignKey: 'cidadeId',
            as: 'cidade'
        });
    }
}

export const ClienteFornecedorInit = (sequelize: Sequelize) => {
    ClienteFornecedor.initialize(sequelize);
    ClienteFornecedor.associate({ Empresa })
    Endereco.initialize(sequelize);
    Endereco.associate()
}

export {
    ClienteFornecedor,
    Endereco
};