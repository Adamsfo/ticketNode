import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface EmpresaAttributes {
    id: number;
    nomeFantasia: string;
    razaoSocial: string;    
    cnpj: string;
    inscricaoEstadual: string;
    inscricaoMunicipal: string;
    dataInicioAtividades: Date;
    cep: string;
    endereco: string;
    numero: string;
    complemento?: string;
    bairro?: string;
    idCidade: number;
    logradouro?: string;
    telefone?: string;
    ultimoNumeroNFe?: number;
    ultimoNumeroNFCe?: number;
    numeroSerieNFe?: number;
    numeroSerieNFCe?: number;
    ambienteNFe: 'Produção' | 'Homologação';
    regimeTributario: 'Simples Nacional' | 'Regime Normal';
    tipo: 'principal' | 'filial';
    CSCID?: string;
    CSC?: string;
}

interface EmpresaCreationAttributes extends Optional<EmpresaAttributes, 'id'> {}

class Empresa extends Model<EmpresaAttributes, EmpresaCreationAttributes> implements EmpresaAttributes {
    public id!: number;
    public nomeFantasia!: string;
    public razaoSocial!: string;
    public cnpj!: string;
    public inscricaoEstadual!: string;
    public inscricaoMunicipal!: string;
    public dataInicioAtividades!: Date;
    public cep!: string;
    public endereco!: string;
    public numero!: string;
    public complemento?: string;
    public bairro!: string;
    public idCidade!: number;
    public logradouro!: string;
    public telefone!: string;
    public ultimoNumeroNFe!: number;
    public ultimoNumeroNFCe!: number;
    public numeroSerieNFe!: number;
    public numeroSerieNFCe!: number;
    public ambienteNFe!: 'Produção' | 'Homologação';
    public regimeTributario!: 'Simples Nacional' | 'Regime Normal';
    public tipo!: 'principal' | 'filial';
    public CSCID!: string;
    public CSC!: string;

    static initialize(sequelize: Sequelize) {
        Empresa.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            nomeFantasia: {
                type: DataTypes.STRING,
                allowNull: false
            },
            razaoSocial: {
                type: DataTypes.STRING,
                allowNull: false
            },
            cnpj: {
                type: DataTypes.STRING,
                unique: true,
                allowNull: false,
                validate: {
                    is: /^\d{14}$/
                }
            },
            inscricaoEstadual: {
                type: DataTypes.STRING,
                allowNull: false
            },
            inscricaoMunicipal: {
                type: DataTypes.STRING,
                allowNull: false
            },
            dataInicioAtividades: {
                type: DataTypes.DATE,
                allowNull: false
            },
            cep: {
                type: DataTypes.STRING,
                allowNull: false,
                validate: {
                    is: /^\d{8}$/
                }
            },
            endereco: DataTypes.STRING,
            numero: {
                type: DataTypes.STRING,
                allowNull: false
            },
            complemento: DataTypes.STRING,
            bairro: {
                type: DataTypes.STRING,
                allowNull: false
            },
            idCidade: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Cidade',
                    key: 'id'
                }
            },
            logradouro: {
                type: DataTypes.STRING,
                allowNull: false
            },
            telefone: {
                type: DataTypes.STRING,
                allowNull: false,
                validate: {
                    is: /^\d{10,11}$/
                }
            },
            ultimoNumeroNFe: {
                type: DataTypes.INTEGER,
                allowNull: true,
                defaultValue: 0
            },
            ultimoNumeroNFCe: {
                type: DataTypes.INTEGER,
                allowNull: true,
                defaultValue: 0
            },
            numeroSerieNFe: {
                type: DataTypes.INTEGER,
                allowNull: true
            },
            numeroSerieNFCe: {
                type: DataTypes.INTEGER,
                allowNull: true
            },
            ambienteNFe: {
                type: DataTypes.ENUM('Produção', 'Homologação'),
                allowNull: false
            },
            regimeTributario: {
                type: DataTypes.ENUM('Simples Nacional', 'Regime Normal'),
                allowNull: false
            },
            tipo: {
                type: DataTypes.ENUM('principal', 'filial'),
                allowNull: false
            },
            CSCID: {
                type: DataTypes.STRING,
                allowNull: true
            },
            CSC: {
                type: DataTypes.STRING,
                allowNull: true
            }
        }, {
            sequelize,
            modelName: "Empresa",
            freezeTableName: true
        });
    }

    static associate(models: any) {
        Empresa.belongsTo(models.Cidade, {
            foreignKey: 'idCidade',
            as: 'cidade'
        });      
    }
}

export const EmpresaInit = (sequelize: Sequelize) => {
    Empresa.initialize(sequelize);
}

export {
    Empresa
};

