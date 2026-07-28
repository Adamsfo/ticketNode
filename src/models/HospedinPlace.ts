import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface HospedinPlaceAttributes {
    id: number;
    place_id: number;
    place_type_id: number | null;
    nome: string;
    capacidade: number | null;
    ativo: boolean;
    payload_json: object | null;
    synced_at: Date;
}

interface HospedinPlaceCreationAttributes
    extends Optional<
        HospedinPlaceAttributes,
        'id' | 'place_type_id' | 'capacidade' | 'ativo' | 'payload_json'
    > {}

class HospedinPlaceModel
    extends Model<HospedinPlaceAttributes, HospedinPlaceCreationAttributes>
    implements HospedinPlaceAttributes
{
    public id!: number;
    public place_id!: number;
    public place_type_id!: number | null;
    public nome!: string;
    public capacidade!: number | null;
    public ativo!: boolean;
    public payload_json!: object | null;
    public synced_at!: Date;

    static initialize(sequelize: Sequelize) {
        HospedinPlaceModel.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                place_id: {
                    type: DataTypes.BIGINT,
                    allowNull: false,
                    unique: true,
                },
                place_type_id: {
                    type: DataTypes.BIGINT,
                    allowNull: true,
                },
                nome: {
                    type: DataTypes.STRING(255),
                    allowNull: false,
                },
                capacidade: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                },
                ativo: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: true,
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
                modelName: 'HospedinPlace',
                tableName: 'hospedin_places',
                freezeTableName: true,
            }
        );
    }

    static associate() {
        // Staging isolado — sem FK para Hospedagem.
    }
}

export const HospedinPlaceInit = (sequelize: Sequelize) => {
    HospedinPlaceModel.initialize(sequelize);
    HospedinPlaceModel.associate();
};

export { HospedinPlaceModel as HospedinPlace };
