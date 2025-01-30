import { Model, DataTypes, Sequelize, Optional } from 'sequelize';
import { Empresa } from './Empresa';

// Atributos da Conta Bancária
interface ContaBancariaAttributes {
    id: number;
    banco: string;
    agencia: string;
    numeroConta: string;
    digito: string;
    tipoConta: 'Corrente' | 'Poupança';
    titular: string;
    cpfCnpj: string;
    saldo?: number;
    convenio?: string;
    carteira?: string;
    empresaId: number;
}

// Atributos necessários para criação (id é auto-incrementado)
interface ContaBancariaCreationAttributes extends Optional<ContaBancariaAttributes, 'id'> {}

// Definição do Modelo
class ContaBancaria extends Model<ContaBancariaAttributes, ContaBancariaCreationAttributes> implements ContaBancariaAttributes {
    public id!: number;
    public banco!: string;
    public agencia!: string;
    public numeroConta!: string;
    public digito!: string;
    public tipoConta!: 'Corrente' | 'Poupança';
    public titular!: string;
    public cpfCnpj!: string;
    public saldo!: number;
    public convenio?: string;
    public carteira?: string;
    public empresaId!: number;

    static initialize(sequelize: Sequelize) {
        ContaBancaria.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            banco: {
                type: DataTypes.STRING(100),
                allowNull: false,
            },
            agencia: {
                type: DataTypes.STRING(20),
                allowNull: false,
            },
            numeroConta: {
                type: DataTypes.STRING(20),
                allowNull: false,
            },
            digito: {
                type: DataTypes.STRING(5),
                allowNull: false,
            },
            tipoConta: {
                type: DataTypes.ENUM('Corrente', 'Poupança'),
                allowNull: false,
            },
            titular: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            cpfCnpj: {
                type: DataTypes.STRING(20),
                allowNull: false,
            },
            saldo: {
                type: DataTypes.DECIMAL(15, 2),
                allowNull: false,
                defaultValue: 0.00,
            },
            convenio: {
                type: DataTypes.STRING(20),
                allowNull: true,
            },
            carteira: {
                type: DataTypes.STRING(20),
                allowNull: true,
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
            modelName: "ContaBancaria",
            freezeTableName: true
        });
    }

    public static associate(models: any) {        
        ContaBancaria.belongsTo(models.Empresa, {
            foreignKey: 'empresaId',
            as: 'empresa',
        });
    }
}

export const ContaBancariaInit = (sequelize: Sequelize) => {
    ContaBancaria.initialize(sequelize);    
    ContaBancaria.associate({Empresa})
}

export {
    ContaBancaria
};
