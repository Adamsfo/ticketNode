import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface ReservaOrigemPayloadAttributes {
    id: number;
    idReservaHospedagem: number;
    provider: string;
    kind: string;
    externalId?: string | null;
    payloadJson: object;
    payloadHash: string;
    capturedAt: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

type Creation = Optional<
    ReservaOrigemPayloadAttributes,
    'id' | 'externalId' | 'createdAt' | 'updatedAt'
>;

class ReservaOrigemPayload
    extends Model<ReservaOrigemPayloadAttributes, Creation>
    implements ReservaOrigemPayloadAttributes
{
    public id!: number;
    public idReservaHospedagem!: number;
    public provider!: string;
    public kind!: string;
    public externalId?: string | null;
    public payloadJson!: object;
    public payloadHash!: string;
    public capturedAt!: Date;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        ReservaOrigemPayload.init(
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
                kind: {
                    type: DataTypes.STRING(40),
                    allowNull: false,
                },
                externalId: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                payloadJson: {
                    type: DataTypes.JSON,
                    allowNull: false,
                },
                payloadHash: {
                    type: DataTypes.STRING(64),
                    allowNull: false,
                },
                capturedAt: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
            },
            {
                sequelize,
                modelName: 'ReservaOrigemPayload',
                tableName: 'reserva_origem_payload',
                freezeTableName: true,
                timestamps: true,
            }
        );
    }

    static associate() {
        const { ReservaHospedagem } = require('./ReservaHospedagem');
        ReservaOrigemPayload.belongsTo(ReservaHospedagem, {
            foreignKey: 'idReservaHospedagem',
            as: 'ReservaHospedagem',
        });
        ReservaHospedagem.hasMany(ReservaOrigemPayload, {
            foreignKey: 'idReservaHospedagem',
            as: 'OrigemPayloads',
        });
    }
}

export const ReservaOrigemPayloadInit = (sequelize: Sequelize) => {
    ReservaOrigemPayload.initialize(sequelize);
    ReservaOrigemPayload.associate();
};

export { ReservaOrigemPayload };
