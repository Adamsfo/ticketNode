import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface ReservaIdentificadorExternoAttributes {
    id: number;
    idReservaHospedagem: number;
    provider: string;
    tipo: string;
    valor: string;
    createdAt?: Date;
    updatedAt?: Date;
}

type Creation = Optional<
    ReservaIdentificadorExternoAttributes,
    'id' | 'createdAt' | 'updatedAt'
>;

class ReservaIdentificadorExterno
    extends Model<ReservaIdentificadorExternoAttributes, Creation>
    implements ReservaIdentificadorExternoAttributes
{
    public id!: number;
    public idReservaHospedagem!: number;
    public provider!: string;
    public tipo!: string;
    public valor!: string;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        ReservaIdentificadorExterno.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                idReservaHospedagem: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                },
                provider: {
                    type: DataTypes.STRING(40),
                    allowNull: false,
                },
                tipo: {
                    type: DataTypes.STRING(40),
                    allowNull: false,
                },
                valor: {
                    type: DataTypes.STRING(128),
                    allowNull: false,
                },
            },
            {
                sequelize,
                modelName: 'ReservaIdentificadorExterno',
                tableName: 'reserva_identificador_externo',
                freezeTableName: true,
                timestamps: true,
            }
        );
    }

    static associate() {
        const { ReservaHospedagem } = require('./ReservaHospedagem');
        ReservaIdentificadorExterno.belongsTo(ReservaHospedagem, {
            foreignKey: 'idReservaHospedagem',
            as: 'ReservaHospedagem',
        });
        ReservaHospedagem.hasMany(ReservaIdentificadorExterno, {
            foreignKey: 'idReservaHospedagem',
            as: 'IdentificadoresExternos',
        });
    }
}

export const ReservaIdentificadorExternoInit = (sequelize: Sequelize) => {
    ReservaIdentificadorExterno.initialize(sequelize);
    ReservaIdentificadorExterno.associate();
};

export { ReservaIdentificadorExterno };
