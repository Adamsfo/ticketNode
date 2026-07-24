import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { ReservaHospedagem } from './ReservaHospedagem';
import { Usuario } from './Usuario';

export type FormaPagamentoRecepcao =
    | 'PIX'
    | 'Dinheiro'
    | 'CartaoCredito'
    | 'CartaoDebito'
    | 'Transferencia'
    | 'Outro';

interface PagamentoHospedagemAttributes {
    id: number;
    idReservaHospedagem: number;
    valor: number;
    dataPagamento: Date;
    formaPagamento: FormaPagamentoRecepcao;
    comprovante?: string | null;
    observacao?: string | null;
    idUsuario: number;
}

interface PagamentoHospedagemCreationAttributes
    extends Optional<
        PagamentoHospedagemAttributes,
        'id' | 'comprovante' | 'observacao'
    > {}

class PagamentoHospedagem
    extends Model<
        PagamentoHospedagemAttributes,
        PagamentoHospedagemCreationAttributes
    >
    implements PagamentoHospedagemAttributes
{
    public id!: number;
    public idReservaHospedagem!: number;
    public valor!: number;
    public dataPagamento!: Date;
    public formaPagamento!: FormaPagamentoRecepcao;
    public comprovante?: string | null;
    public observacao?: string | null;
    public idUsuario!: number;

    static initialize(sequelize: Sequelize) {
        PagamentoHospedagem.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                idReservaHospedagem: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: 'ReservaHospedagem',
                        key: 'id',
                    },
                },
                valor: {
                    type: DataTypes.DECIMAL(14, 2),
                    allowNull: false,
                },
                dataPagamento: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                formaPagamento: {
                    type: DataTypes.STRING(40),
                    allowNull: false,
                },
                comprovante: {
                    type: DataTypes.STRING(255),
                    allowNull: true,
                },
                observacao: {
                    type: DataTypes.TEXT,
                    allowNull: true,
                },
                idUsuario: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: 'Usuario',
                        key: 'id',
                    },
                },
            },
            {
                sequelize,
                modelName: 'PagamentoHospedagem',
                freezeTableName: true,
            }
        );
    }

    static associate() {
        PagamentoHospedagem.belongsTo(ReservaHospedagem, {
            foreignKey: 'idReservaHospedagem',
            as: 'ReservaHospedagem',
        });
        PagamentoHospedagem.belongsTo(Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario',
        });
        ReservaHospedagem.hasMany(PagamentoHospedagem, {
            foreignKey: 'idReservaHospedagem',
            as: 'Pagamentos',
        });
    }
}

export const PagamentoHospedagemInit = (sequelize: Sequelize) => {
    PagamentoHospedagem.initialize(sequelize);
    PagamentoHospedagem.associate();
};

export { PagamentoHospedagem };
