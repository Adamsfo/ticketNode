import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { ClienteFornecedor } from './ClienteFornecedor';

interface TipoContaAttributes {
    id: number;
    tipoConta: string;
}

interface TipoContaCreationAttributes extends Optional<TipoContaAttributes, 'id'> { }

class TipoConta extends Model<TipoContaAttributes, TipoContaCreationAttributes> implements TipoContaAttributes {    
    public id!: number;
    public tipoConta!: string;

    static initialize(sequelize: Sequelize) {
        TipoConta.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                tipoConta: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
            }, {
            sequelize,
            modelName: "TipoConta",
            freezeTableName: true
        }
        );
    }
}

interface TipoContaDetalheAttributes {
    id: number;
    detalheTipoConta: string;
}

interface TipoContaDetalheCreationAttributes extends Optional<TipoContaDetalheAttributes, 'id'> { }

class TipoContaDetalhe extends Model<TipoContaDetalheAttributes, TipoContaDetalheCreationAttributes> implements TipoContaDetalheAttributes {    
    public id!: number;
    public detalheTipoConta!: string;

    static initialize(sequelize: Sequelize) {
        TipoContaDetalhe.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                detalheTipoConta: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
            }, {
            sequelize,
            modelName: "TipoContaDetalhe",
            freezeTableName: true
        }
        );
    }
}

interface ContaAPagarAttributes {
    id: number;
    NumeroLancamento?: string;
    Parcela?: number;
    tipoContaId?: number;
    tipoContaDetalheId?: number;
    clientefornecedorId?: number;
    descricao: string;
    vencimento: Date;
    dataPagamento?: Date;
    formaPagamento?: string;
    obs?: string;
    numeroNF?: string;
    serie?: string;
    dataEntrada?: Date;
    total: number;
    status: 'pendente' | 'pago' | 'atrasado';
}

interface ContaAPagarCreationAttributes extends Optional<ContaAPagarAttributes, 'id'> { }

class ContaAPagar extends Model<ContaAPagarAttributes, ContaAPagarCreationAttributes> implements ContaAPagarAttributes {
    public id!: number;
    public NumeroLancamento?: string;
    public Parcela?: number;
    public tipoContaId?: number;
    public tipoContaDetalheId?: number;
    public clientefornecedorId?: number;
    public descricao!: string;
    public vencimento!: Date;
    public dataPagamento?: Date;
    public formaPagamento?: string;
    public obs?: string;
    public numeroNF?: string;
    public serie?: string;
    public dataEntrada?: Date;
    public total!: number;
    public status!: 'pendente' | 'pago' | 'atrasado';

    static initialize(sequelize: Sequelize) {
        ContaAPagar.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                NumeroLancamento: {
                    type: DataTypes.STRING,
                    allowNull: true,
                },
                Parcela: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                },
                tipoContaId: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                    references: {
                        model: TipoConta,
                        key: 'id'
                    }
                },
                tipoContaDetalheId: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                    references: {
                        model: TipoContaDetalhe,
                        key: 'id'
                    }
                },
                clientefornecedorId: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                    references: {
                        model: ClienteFornecedor,
                        key: 'id'
                    }
                },
                descricao: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                vencimento: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                dataPagamento: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
                formaPagamento: {
                    type: DataTypes.STRING,
                    allowNull: true,
                },
                obs: {
                    type: DataTypes.STRING,
                    allowNull: true,
                },
                numeroNF: {
                    type: DataTypes.STRING,
                    allowNull: true,
                },
                serie: {
                    type: DataTypes.STRING,
                    allowNull: true,
                },
                dataEntrada: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
                total: {
                    type: DataTypes.FLOAT,
                    allowNull: false,
                },
                status: {
                    type: DataTypes.ENUM('pendente', 'pago', 'atrasado'),
                    allowNull: false,
                },
            }, {
            sequelize,
            modelName: "ContaAPagar",
            freezeTableName: true
        }
        );
    }

    static associate(models: any) {
        ContaAPagar.belongsTo(models.TipoConta, {
            foreignKey: 'tipoContaId',
            as: 'tipoConta',
        });
        ContaAPagar.belongsTo(models.TipoContaDetalhe, {
            foreignKey: 'tipoContaDetalheId',
            as: 'tipoContaDetalhe',
        });
        ContaAPagar.belongsTo(models.ClienteFornecedor, {
            foreignKey: 'clientefornecedorId',
            as: 'clienteFornecedor',
        });
    }
}

export const ContaAPagarInit = (sequelize: Sequelize) => {
    TipoConta.initialize(sequelize);
    TipoContaDetalhe.initialize(sequelize);
    ContaAPagar.initialize(sequelize);
    ContaAPagar.associate({ TipoConta, TipoContaDetalhe, ClienteFornecedor });
}

export {
    TipoConta,
    TipoContaDetalhe
};
