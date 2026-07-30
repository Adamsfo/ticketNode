import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

export const IntegrationProviderRuntimeStatus = {
    IDLE: 'IDLE',
    RUNNING: 'RUNNING',
    ERROR: 'ERROR',
    DISABLED: 'DISABLED',
    WAITING_RETRY: 'WAITING_RETRY',
} as const;

export type IntegrationProviderRuntimeStatusValue =
    (typeof IntegrationProviderRuntimeStatus)[keyof typeof IntegrationProviderRuntimeStatus];

interface IntegrationProviderStateAttributes {
    id: number;
    provider: string;
    status: IntegrationProviderRuntimeStatusValue | string;
    lastStartedAt?: Date | null;
    /** Atualizado periodicamente enquanto o ciclo está vivo neste processo. */
    heartbeatAt?: Date | null;
    lastFinishedAt?: Date | null;
    lastSuccessAt?: Date | null;
    lastErrorAt?: Date | null;
    lastErrorMessage?: string | null;
    nextRunAt?: Date | null;
    lastDurationMs?: number | null;
    consecutiveFailures: number;
    lastExecutionId?: number | null;
    createdAt?: Date;
    updatedAt?: Date;
}

type Creation = Optional<
    IntegrationProviderStateAttributes,
    | 'id'
    | 'status'
    | 'lastStartedAt'
    | 'heartbeatAt'
    | 'lastFinishedAt'
    | 'lastSuccessAt'
    | 'lastErrorAt'
    | 'lastErrorMessage'
    | 'nextRunAt'
    | 'lastDurationMs'
    | 'consecutiveFailures'
    | 'lastExecutionId'
    | 'createdAt'
    | 'updatedAt'
>;

class IntegrationProviderState
    extends Model<IntegrationProviderStateAttributes, Creation>
    implements IntegrationProviderStateAttributes
{
    public id!: number;
    public provider!: string;
    public status!: IntegrationProviderRuntimeStatusValue | string;
    public lastStartedAt?: Date | null;
    public heartbeatAt?: Date | null;
    public lastFinishedAt?: Date | null;
    public lastSuccessAt?: Date | null;
    public lastErrorAt?: Date | null;
    public lastErrorMessage?: string | null;
    public nextRunAt?: Date | null;
    public lastDurationMs?: number | null;
    public consecutiveFailures!: number;
    public lastExecutionId?: number | null;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        IntegrationProviderState.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                provider: {
                    type: DataTypes.STRING(40),
                    allowNull: false,
                    unique: true,
                },
                status: {
                    type: DataTypes.STRING(20),
                    allowNull: false,
                    defaultValue: IntegrationProviderRuntimeStatus.IDLE,
                },
                lastStartedAt: { type: DataTypes.DATE, allowNull: true },
                heartbeatAt: { type: DataTypes.DATE, allowNull: true },
                lastFinishedAt: { type: DataTypes.DATE, allowNull: true },
                lastSuccessAt: { type: DataTypes.DATE, allowNull: true },
                lastErrorAt: { type: DataTypes.DATE, allowNull: true },
                lastErrorMessage: { type: DataTypes.TEXT, allowNull: true },
                nextRunAt: { type: DataTypes.DATE, allowNull: true },
                lastDurationMs: { type: DataTypes.INTEGER, allowNull: true },
                consecutiveFailures: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 0,
                },
                lastExecutionId: { type: DataTypes.INTEGER, allowNull: true },
            },
            {
                sequelize,
                modelName: 'IntegrationProviderState',
                tableName: 'integration_provider_state',
                freezeTableName: true,
                timestamps: true,
                underscored: true,
            }
        );
    }
}

export const IntegrationProviderStateInit = (sequelize: Sequelize) => {
    IntegrationProviderState.initialize(sequelize);
};

export { IntegrationProviderState };
