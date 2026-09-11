import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { ReservaSuite } from './ReservaSuite';
import { Usuario } from './Usuario';

interface ReservaSuiteItemServicoAttributes {
    id: number;
    idReservaSuite: number;
    descricao: string;
    valor: number;
    ordem: number;
    idUsuarioCriacao?: number | null;
    createdAt?: Date;
    updatedAt?: Date;
}

interface ReservaSuiteItemServicoCreationAttributes
    extends Optional<
        ReservaSuiteItemServicoAttributes,
        'id' | 'ordem' | 'idUsuarioCriacao' | 'createdAt' | 'updatedAt'
    > {}

class ReservaSuiteItemServico
    extends Model<
        ReservaSuiteItemServicoAttributes,
        ReservaSuiteItemServicoCreationAttributes
    >
    implements ReservaSuiteItemServicoAttributes
{
    public id!: number;
    public idReservaSuite!: number;
    public descricao!: string;
    public valor!: number;
    public ordem!: number;
    public idUsuarioCriacao?: number | null;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        ReservaSuiteItemServico.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                idReservaSuite: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: 'ReservaSuite',
                        key: 'id',
                    },
                },
                descricao: {
                    type: DataTypes.STRING(500),
                    allowNull: false,
                },
                valor: {
                    type: DataTypes.DECIMAL(14, 2),
                    allowNull: false,
                },
                ordem: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 1,
                },
                idUsuarioCriacao: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                    references: {
                        model: 'Usuario',
                        key: 'id',
                    },
                },
            },
            {
                sequelize,
                modelName: 'ReservaSuiteItemServico',
                freezeTableName: true,
                underscored: true,
            }
        );
    }

    static associate() {
        ReservaSuiteItemServico.belongsTo(ReservaSuite, {
            foreignKey: 'idReservaSuite',
            as: 'ReservaSuite',
        });
        ReservaSuiteItemServico.belongsTo(Usuario, {
            foreignKey: 'idUsuarioCriacao',
            as: 'UsuarioCriacao',
        });
        ReservaSuite.hasMany(ReservaSuiteItemServico, {
            foreignKey: 'idReservaSuite',
            as: 'ItemServico',
        });
    }
}

export const ReservaSuiteItemServicoInit = (sequelize: Sequelize) => {
    ReservaSuiteItemServico.initialize(sequelize);
    ReservaSuiteItemServico.associate();
};

export { ReservaSuiteItemServico };
