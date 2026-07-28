import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface HospedinReservationAttributes {
    id: number;
    reservation_id: number;
    status: string | null;
    checkin: Date | null;
    checkout: Date | null;
    payload_json: object | null;
    imported_at: Date;
    updated_at: Date;
}

interface HospedinReservationCreationAttributes
    extends Optional<
        HospedinReservationAttributes,
        'id' | 'status' | 'checkin' | 'checkout' | 'payload_json'
    > {}

class HospedinReservationModel
    extends Model<
        HospedinReservationAttributes,
        HospedinReservationCreationAttributes
    >
    implements HospedinReservationAttributes
{
    public id!: number;
    public reservation_id!: number;
    public status!: string | null;
    public checkin!: Date | null;
    public checkout!: Date | null;
    public payload_json!: object | null;
    public imported_at!: Date;
    public updated_at!: Date;

    static initialize(sequelize: Sequelize) {
        HospedinReservationModel.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                reservation_id: {
                    type: DataTypes.BIGINT,
                    allowNull: false,
                    unique: true,
                },
                status: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                checkin: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
                checkout: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
                payload_json: {
                    type: DataTypes.JSON,
                    allowNull: true,
                },
                imported_at: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                updated_at: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
            },
            {
                sequelize,
                modelName: 'HospedinReservation',
                tableName: 'hospedin_reservations',
                freezeTableName: true,
                timestamps: false,
            }
        );
    }

    static associate() {
        // Staging isolado — sem FK para Hospedagem.
    }
}

export const HospedinReservationInit = (sequelize: Sequelize) => {
    HospedinReservationModel.initialize(sequelize);
    HospedinReservationModel.associate();
};

export { HospedinReservationModel as HospedinReservation };
