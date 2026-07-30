import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

export const IntegrationProvider = {
    HOSPEDIN: 'HOSPEDIN',
} as const;

export type IntegrationProviderValue =
    (typeof IntegrationProvider)[keyof typeof IntegrationProvider];

export const IntegrationEntityType = {
    RESERVATION: 'RESERVATION',
    PLACE: 'PLACE',
    PLACE_TYPE: 'PLACE_TYPE',
    GUEST: 'GUEST',
} as const;

export type IntegrationEntityTypeValue =
    (typeof IntegrationEntityType)[keyof typeof IntegrationEntityType];

export const IntegrationSyncStatus = {
    NEW: 'NEW',
    VALIDATED: 'VALIDATED',
    READY: 'READY',
    QUEUED: 'QUEUED',
    SYNCING: 'SYNCING',
    SYNCED: 'SYNCED',
    FAILED: 'FAILED',
    WAIT_MAPPING: 'WAIT_MAPPING',
    IGNORED: 'IGNORED',
} as const;

export type IntegrationSyncStatusValue =
    (typeof IntegrationSyncStatus)[keyof typeof IntegrationSyncStatus];

interface IntegrationSyncStateAttributes {
    id: number;
    provider: IntegrationProviderValue | string;
    entity_type: IntegrationEntityTypeValue | string;
    external_id: string;
    /** ID da entidade no domínio Jango (ex.: ReservaHospedagem.id). */
    internal_entity_id: string | null;
    correlation_id: string;
    validation_status: string | null;
    sync_action: string | null;
    sync_status: IntegrationSyncStatusValue | string;
    payload_hash: string | null;
    retry_count: number;
    /**
     * Contador monotônico de sincronizações efetivamente aplicadas
     * (CREATE / UPDATE com mudanças / CANCEL efetivo). Não sobe em UNCHANGED/CONFLICT/FAILED.
     */
    sync_version: number;
    last_validation_at: Date | null;
    last_sync_at: Date | null;
    last_error: string | null;
    error_code: string | null;
    error_severityity: string | null;
    resolution_status: string;
    last_success_at: Date | null;
    next_retry_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

interface IntegrationSyncStateCreationAttributes
    extends Optional<
        IntegrationSyncStateAttributes,
        | 'id'
        | 'internal_entity_id'
        | 'validation_status'
        | 'sync_action'
        | 'payload_hash'
        | 'retry_count'
        | 'sync_version'
        | 'last_validation_at'
        | 'last_sync_at'
        | 'last_error'
        | 'error_code'
        | 'error_severityity'
        | 'resolution_status'
        | 'last_success_at'
        | 'next_retry_at'
        | 'sync_status'
    > {}

class IntegrationSyncStateModel
    extends Model<
        IntegrationSyncStateAttributes,
        IntegrationSyncStateCreationAttributes
    >
    implements IntegrationSyncStateAttributes
{
    public id!: number;
    public provider!: IntegrationProviderValue | string;
    public entity_type!: IntegrationEntityTypeValue | string;
    public external_id!: string;
    public internal_entity_id!: string | null;
    public correlation_id!: string;
    public validation_status!: string | null;
    public sync_action!: string | null;
    public sync_status!: IntegrationSyncStatusValue | string;
    public payload_hash!: string | null;
    public retry_count!: number;
    public sync_version!: number;
    public last_validation_at!: Date | null;
    public last_sync_at!: Date | null;
    public last_error!: string | null;
    public error_code!: string | null;
    public error_severityity!: string | null;
    public resolution_status!: string;
    public last_success_at!: Date | null;
    public next_retry_at!: Date | null;
    public created_at!: Date;
    public updated_at!: Date;

    static initialize(sequelize: Sequelize) {
        IntegrationSyncStateModel.init(
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
                entity_type: {
                    type: DataTypes.STRING(40),
                    allowNull: false,
                },
                external_id: {
                    type: DataTypes.STRING(128),
                    allowNull: false,
                },
                internal_entity_id: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                correlation_id: {
                    type: DataTypes.STRING(64),
                    allowNull: false,
                },
                validation_status: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                sync_action: {
                    type: DataTypes.STRING(32),
                    allowNull: true,
                },
                sync_status: {
                    type: DataTypes.STRING(32),
                    allowNull: false,
                    defaultValue: IntegrationSyncStatus.NEW,
                },
                payload_hash: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                retry_count: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 0,
                },
                sync_version: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 0,
                },
                last_validation_at: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
                last_sync_at: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
                last_error: {
                    type: DataTypes.TEXT,
                    allowNull: true,
                },
                error_code: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                error_severityity: {
                    type: DataTypes.STRING(20),
                    allowNull: true,
                },
                resolution_status: {
                    type: DataTypes.STRING(20),
                    allowNull: false,
                    defaultValue: 'OPEN',
                },
                last_success_at: {
                    type: DataTypes.DATE,
                    allowNull: true,
                },
                next_retry_at: {
                    type: DataTypes.DATE,
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
                modelName: 'IntegrationSyncState',
                tableName: 'integration_sync_state',
                freezeTableName: true,
                timestamps: false,
            }
        );
    }

    static associate() {
        // Isolado do domínio Jango.
    }
}

export const IntegrationSyncStateInit = (sequelize: Sequelize) => {
    IntegrationSyncStateModel.initialize(sequelize);
    IntegrationSyncStateModel.associate();
};

export { IntegrationSyncStateModel as IntegrationSyncState };
