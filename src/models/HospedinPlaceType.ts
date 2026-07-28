import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface HospedinPlaceTypeAttributes {
    id: number;
    place_type_id: number;
    nome: string;
    capacidade: number | null;
    payload_json: object | null;
    synced_at: Date;
}

interface HospedinPlaceTypeCreationAttributes
    extends Optional<
        HospedinPlaceTypeAttributes,
        'id' | 'capacidade' | 'payload_json'
    > {}

class HospedinPlaceTypeModel
    extends Model<
        HospedinPlaceTypeAttributes,
        HospedinPlaceTypeCreationAttributes
    >
    implements HospedinPlaceTypeAttributes
{
    public id!: number;
    public place_type_id!: number;
    public nome!: string;
    public capacidade!: number | null;
    public payload_json!: object | null;
    public synced_at!: Date;

    static initialize(sequelize: Sequelize) {
        HospedinPlaceTypeModel.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                place_type_id: {
                    type: DataTypes.BIGINT,
                    allowNull: false,
                    unique: true,
                },
                nome: {
                    type: DataTypes.STRING(255),
                    allowNull: false,
                },
                capacidade: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                },
                payload_json: {
                    type: DataTypes.JSON,
                    allowNull: true,
                },
                synced_at: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
            },
            {
                sequelize,
                modelName: 'HospedinPlaceType',
                tableName: 'hospedin_place_types',
                freezeTableName: true,
            }
        );
    }

    static associate() {
        // Staging isolado — sem FK para Hospedagem.
    }
}

export const HospedinPlaceTypeInit = (sequelize: Sequelize) => {
    HospedinPlaceTypeModel.initialize(sequelize);
    HospedinPlaceTypeModel.associate();
};

export { HospedinPlaceTypeModel as HospedinPlaceType };
