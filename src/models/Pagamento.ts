import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { Empresa } from './Empresa';

interface PagamentoAttributes {
    id: number;
    valor: number;
    dataPagamento?: Date;
    metodo: 'cartao' | 'boleto' | 'pix';
    // caixaItemId?: number | null;  // Adicionado para vincular ao CaixaItem
    empresaId: number;
}

interface PagamentoCreationAttributes extends Optional<PagamentoAttributes, 'id'> { }

class Pagamento extends Model<PagamentoAttributes, PagamentoCreationAttributes> implements PagamentoAttributes {
    public id!: number;
    public valor!: number;
    public dataPagamento!: Date;
    public metodo!: 'cartao' | 'boleto' | 'pix';
    // public caixaItemId!: number | null;
    public empresaId!: number;

    static initialize(sequelize: Sequelize) {
        Pagamento.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            valor: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: false,
            },
            dataPagamento: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            metodo: {
                type: DataTypes.ENUM('cartao', 'boleto', 'pix'),
                allowNull: false,
            },
            // caixaItemId: {
            //     type: DataTypes.INTEGER,
            //     allowNull: true,
            //     references: {
            //         model: 'CaixaItem',
            //         key: 'id'
            //     },
            // },
            empresaId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Empresa',
                    key: 'id'
                },
            }
        }, {
            sequelize,
            modelName: "Pagamento",
            freezeTableName: true,
            timestamps: true,
        });
    }

    static associate(models: any) {
        // Pagamento.belongsTo(models.CaixaItem, { foreignKey: 'caixaItemId' });
        Pagamento.belongsTo(models.Empresa, { foreignKey: 'empresaId' });
    }
}

export const PagamentoInit = (sequelize: Sequelize) => {
    Pagamento.initialize(sequelize);

    Pagamento.associate({ Empresa });
}

export {
    Pagamento
};