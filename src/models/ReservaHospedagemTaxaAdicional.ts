import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { ReservaHospedagem } from './ReservaHospedagem';
import { ReservaSuite } from './ReservaSuite';
import { Usuario } from './Usuario';

interface ReservaHospedagemTaxaAdicionalAttributes {
    id: number;
    idReservaHospedagem: number;
    idReservaSuite?: number | null;
    descricao: string;
    valor: number;
    ordem: number;
    idUsuarioCriacao?: number | null;
    createdAt?: Date;
    updatedAt?: Date;
}

interface ReservaHospedagemTaxaAdicionalCreationAttributes
    extends Optional<
        ReservaHospedagemTaxaAdicionalAttributes,
        'id' | 'ordem' | 'idUsuarioCriacao' | 'createdAt' | 'updatedAt'
    > {}

class ReservaHospedagemTaxaAdicional
    extends Model<
        ReservaHospedagemTaxaAdicionalAttributes,
        ReservaHospedagemTaxaAdicionalCreationAttributes
    >
    implements ReservaHospedagemTaxaAdicionalAttributes
{
    public id!: number;
    public idReservaHospedagem!: number;
    public idReservaSuite?: number | null;
    public descricao!: string;
    public valor!: number;
    public ordem!: number;
    public idUsuarioCriacao?: number | null;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        ReservaHospedagemTaxaAdicional.init(
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
                idReservaSuite: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
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
                modelName: 'ReservaHospedagemTaxaAdicional',
                freezeTableName: true,
                underscored: true,
            }
        );
    }

    static associate() {
        ReservaHospedagemTaxaAdicional.belongsTo(ReservaHospedagem, {
            foreignKey: 'idReservaHospedagem',
            as: 'ReservaHospedagem',
        });
        ReservaHospedagemTaxaAdicional.belongsTo(Usuario, {
            foreignKey: 'idUsuarioCriacao',
            as: 'UsuarioCriacao',
        });
        ReservaHospedagemTaxaAdicional.belongsTo(ReservaSuite, {
            foreignKey: 'idReservaSuite',
            as: 'ReservaSuite',
        });
        ReservaSuite.hasMany(ReservaHospedagemTaxaAdicional, {
            foreignKey: 'idReservaSuite',
            as: 'TaxaAdicional',
        });
        ReservaHospedagem.hasMany(ReservaHospedagemTaxaAdicional, {
            foreignKey: 'idReservaHospedagem',
            as: 'TaxaAdicional',
        });
    }
}

export const ReservaHospedagemTaxaAdicionalInit = (sequelize: Sequelize) => {
    ReservaHospedagemTaxaAdicional.initialize(sequelize);
    ReservaHospedagemTaxaAdicional.associate();
};

export { ReservaHospedagemTaxaAdicional };
