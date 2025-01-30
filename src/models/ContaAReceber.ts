import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { ClienteFornecedor } from './ClienteFornecedor';
import { Empresa } from './Empresa';

interface ContaAReceberAttributes {
    id: number;
    descricao: string;
    clientefornecedorId: number;   
    empresaId: number; 
    valor: number;
    valorRecebido?: number;        
    observacao?: string;
    dataVencimento: Date;
    dataPagamento?: Date;
    status: 'Pendente' | 'Pago' | 'Atrasado' | 'Cancelado';
}

interface ContaAReceberCreationAttributes extends Optional<ContaAReceberAttributes, 'id'> { }

class ContaAReceber extends Model<ContaAReceberAttributes, ContaAReceberCreationAttributes> implements ContaAReceberAttributes {
    public id!: number;
    public descricao!: string;
    public clientefornecedorId!: number;
    public empresaId!: number;
    public valor!: number;
    public valorRecebido?: number;
    public observacao?: string;
    public dataVencimento!: Date;
    public dataPagamento?: Date;
    public status!: 'Pendente' | 'Pago' | 'Atrasado' | 'Cancelado';
    
    public static initialize(sequelize: Sequelize) {
        ContaAReceber.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                descricao: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                clientefornecedorId: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: ClienteFornecedor,
                        key: 'id'
                    }
                },
                empresaId: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: Empresa,
                        key: 'id'
                    }
                },
                valor: {
                    type: DataTypes.FLOAT,
                    allowNull: false,
                },
                valorRecebido: {
                    type: DataTypes.FLOAT,
                    allowNull: false,
                },
                observacao: {
                    type: DataTypes.STRING,
                    allowNull: true,
                },
                dataVencimento: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                dataPagamento: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
                status: {
                    type: DataTypes.ENUM('Pendente', 'Pago', 'Atrasado', 'Cancelado'),
                    allowNull: false,
                },
            }, {
                sequelize,
                modelName: "ContaAReceber",
                freezeTableName: true
            }
        );
    }

    public static associate(models: any) {
        ContaAReceber.belongsTo(models.ClienteFornecedor, {
            foreignKey: 'clientefornecedorId',
            as: 'clienteFornecedor',
        });
        ContaAReceber.belongsTo(models.Empresa, {
            foreignKey: 'empresaId',
            as: 'empresa',
        });
    }
}

export const ContaAReceberInit = (sequelize: Sequelize) => {
    ContaAReceber.initialize(sequelize);    
    ContaAReceber.associate({ClienteFornecedor, Empresa});
}

export {
    ContaAReceber
};