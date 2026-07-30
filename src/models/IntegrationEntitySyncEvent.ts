import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface IntegrationEntitySyncEventAttributes {
    id: number;
    provider: string;
    entityType: string;
    externalId: string;
    internalEntityId?: string | null;
    operation: string;
    result: string;
    errorCode?: string | null;
    errorSeverity?: string | null;
    message?: string | null;
    durationMs?: number | null;
    correlationId?: string | null;
    createdAt?: Date;
}

type Creation = Optional<
    IntegrationEntitySyncEventAttributes,
    | 'id'
    | 'internalEntityId'
    | 'errorCode'
    | 'errorSeverity'
    | 'message'
    | 'durationMs'
    | 'correlationId'
    | 'createdAt'
>;

class IntegrationEntitySyncEvent
    extends Model<IntegrationEntitySyncEventAttributes, Creation>
    implements IntegrationEntitySyncEventAttributes
{
    public id!: number;
    public provider!: string;
    public entityType!: string;
    public externalId!: string;
    public internalEntityId?: string | null;
    public operation!: string;
    public result!: string;
    public errorCode?: string | null;
    public errorSeverity?: string | null;
    public message?: string | null;
    public durationMs?: number | null;
    public correlationId?: string | null;
    public readonly createdAt!: Date;

    static initialize(sequelize: Sequelize) {
        IntegrationEntitySyncEvent.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                provider: {
                    type: DataTypes.STRING(40),
                    allowNull: false,
                },
                entityType: {
                    type: DataTypes.STRING(40),
                    allowNull: false,
                    field: 'entity_type',
                },
                externalId: {
                    type: DataTypes.STRING(128),
                    allowNull: false,
                    field: 'external_id',
                },
                internalEntityId: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                    field: 'internal_entity_id',
                },
                operation: {
                    type: DataTypes.STRING(32),
                    allowNull: false,
                },
                result: {
                    type: DataTypes.STRING(20),
                    allowNull: false,
                },
                errorCode: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                    field: 'error_code',
                },
                errorSeverity: {
                    type: DataTypes.STRING(20),
                    allowNull: true,
                    field: 'error_severityity',
                },
                message: { type: DataTypes.TEXT, allowNull: true },
                durationMs: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                    field: 'duration_ms',
                },
                correlationId: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                    field: 'correlation_id',
                },
                createdAt: {
                    type: DataTypes.DATE,
                    allowNull: false,
                    field: 'created_at',
                },
            },
            {
                sequelize,
                modelName: 'IntegrationEntitySyncEvent',
                tableName: 'integration_entity_sync_event',
                freezeTableName: true,
                timestamps: true,
                updatedAt: false,
                createdAt: 'created_at',
            }
        );
    }
}

export const IntegrationEntitySyncEventInit = (sequelize: Sequelize) => {
    IntegrationEntitySyncEvent.initialize(sequelize);
};

export { IntegrationEntitySyncEvent };
