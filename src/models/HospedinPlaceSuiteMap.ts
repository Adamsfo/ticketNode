import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { EventoSuite } from './EventoSuite';

/** Estado operacional do mapeamento. UNMAPPED = sem linha ativa. */
export const PlaceSuiteMappingStatus = {
    LINKED: 'LINKED',
    IGNORED: 'IGNORED',
} as const;

export type PlaceSuiteMappingStatusValue =
    (typeof PlaceSuiteMappingStatus)[keyof typeof PlaceSuiteMappingStatus];

interface HospedinPlaceSuiteMapAttributes {
    id: number;
    provider: string;
    place_id: number;
    id_evento_suite: number | null;
    id_evento: number | null;
    ativo: boolean;
    mapping_status: string;
    notes: string | null;
    mapped_at: Date;
    mapped_by: number | null;
    created_at: Date;
    updated_at: Date;
}

interface HospedinPlaceSuiteMapCreationAttributes
    extends Optional<
        HospedinPlaceSuiteMapAttributes,
        | 'id'
        | 'provider'
        | 'id_evento_suite'
        | 'id_evento'
        | 'ativo'
        | 'mapping_status'
        | 'notes'
        | 'mapped_by'
    > {}

class HospedinPlaceSuiteMapModel
    extends Model<
        HospedinPlaceSuiteMapAttributes,
        HospedinPlaceSuiteMapCreationAttributes
    >
    implements HospedinPlaceSuiteMapAttributes
{
    public id!: number;
    public provider!: string;
    public place_id!: number;
    public id_evento_suite!: number | null;
    public id_evento!: number | null;
    public ativo!: boolean;
    public mapping_status!: string;
    public notes!: string | null;
    public mapped_at!: Date;
    public mapped_by!: number | null;
    public created_at!: Date;
    public updated_at!: Date;

    static initialize(sequelize: Sequelize) {
        HospedinPlaceSuiteMapModel.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                provider: {
                    type: DataTypes.STRING(40),
                    allowNull: false,
                    defaultValue: 'HOSPEDIN',
                },
                place_id: {
                    type: DataTypes.BIGINT,
                    allowNull: false,
                    unique: true,
                },
                id_evento_suite: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                    unique: true,
                    references: {
                        model: EventoSuite,
                        key: 'id',
                    },
                },
                id_evento: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                },
                ativo: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: true,
                },
                mapping_status: {
                    type: DataTypes.STRING(20),
                    allowNull: false,
                    defaultValue: PlaceSuiteMappingStatus.LINKED,
                },
                notes: {
                    type: DataTypes.STRING(255),
                    allowNull: true,
                },
                mapped_at: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                mapped_by: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                },
                created_at: {
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
                modelName: 'HospedinPlaceSuiteMap',
                tableName: 'hospedin_place_suite_map',
                freezeTableName: true,
                timestamps: false,
            }
        );
    }

    static associate() {
        HospedinPlaceSuiteMapModel.belongsTo(EventoSuite, {
            foreignKey: 'id_evento_suite',
            as: 'EventoSuite',
            constraints: false,
        });
    }
}

export const HospedinPlaceSuiteMapInit = (sequelize: Sequelize) => {
    HospedinPlaceSuiteMapModel.initialize(sequelize);
    HospedinPlaceSuiteMapModel.associate();
};

export { HospedinPlaceSuiteMapModel as HospedinPlaceSuiteMap };
