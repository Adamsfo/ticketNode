import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { EventoSuite } from './EventoSuite';

interface EventoSuiteFotoAttributes {
    id: number;
    idEventoSuite: number;
    arquivo: string;
    ordem: number;
    principal: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

interface EventoSuiteFotoCreationAttributes
    extends Optional<
        EventoSuiteFotoAttributes,
        'id' | 'ordem' | 'principal' | 'createdAt' | 'updatedAt'
    > {}

class EventoSuiteFoto
    extends Model<EventoSuiteFotoAttributes, EventoSuiteFotoCreationAttributes>
    implements EventoSuiteFotoAttributes
{
    public id!: number;
    public idEventoSuite!: number;
    public arquivo!: string;
    public ordem!: number;
    public principal!: boolean;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        EventoSuiteFoto.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                idEventoSuite: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    field: 'id_evento_suite',
                    references: {
                        model: EventoSuite,
                        key: 'id',
                    },
                },
                arquivo: {
                    type: DataTypes.STRING(255),
                    allowNull: false,
                },
                ordem: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 1,
                },
                principal: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: false,
                },
            },
            {
                sequelize,
                modelName: 'EventoSuiteFoto',
                freezeTableName: true,
                underscored: true,
            }
        );
    }

    static associate() {
        EventoSuiteFoto.belongsTo(EventoSuite, {
            foreignKey: 'idEventoSuite',
            as: 'EventoSuite',
        });

        EventoSuite.hasMany(EventoSuiteFoto, {
            foreignKey: 'idEventoSuite',
            as: 'Fotos',
        });
    }
}

export const EventoSuiteFotoInit = (sequelize: Sequelize) => {
    EventoSuiteFoto.initialize(sequelize);
    EventoSuiteFoto.associate();
};

export { EventoSuiteFoto };
