import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

export const IntegrationSyncTrigger = {
    SCHEDULER: 'SCHEDULER',
    MANUAL: 'MANUAL',
    API: 'API',
    WEBHOOK: 'WEBHOOK',
    RETRY: 'RETRY',
} as const;

export type IntegrationSyncTriggerValue =
    (typeof IntegrationSyncTrigger)[keyof typeof IntegrationSyncTrigger];

export const IntegrationSyncExecutionStatus = {
    RUNNING: 'RUNNING',
    SUCCESS: 'SUCCESS',
    PARTIAL: 'PARTIAL',
    FAILED: 'FAILED',
    SKIPPED: 'SKIPPED',
    /** Crash / restart / timeout / watchdog — execução não concluiu. */
    ABORTED: 'ABORTED',
} as const;

export type IntegrationSyncExecutionStatusValue =
    (typeof IntegrationSyncExecutionStatus)[keyof typeof IntegrationSyncExecutionStatus];

interface IntegrationSyncExecutionAttributes {
    id: number;
    provider: string;
    triggerSource: IntegrationSyncTriggerValue | string;
    mode?: string | null;
    correlationId: string;
    startedAt: Date;
    finishedAt?: Date | null;
    durationMs?: number | null;
    status: IntegrationSyncExecutionStatusValue | string;
    imported?: number | null;
    validated?: number | null;
    validatedReady?: number | null;
    validatedIgnored?: number | null;
    createdCount?: number | null;
    updatedCount?: number | null;
    cancelledCount?: number | null;
    failedCount?: number | null;
    skippedCount?: number | null;
    unchangedCount?: number | null;
    errorMessage?: string | null;
    summaryJson?: object | null;
    createdAt?: Date;
    updatedAt?: Date;
}

type Creation = Optional<
    IntegrationSyncExecutionAttributes,
    | 'id'
    | 'mode'
    | 'finishedAt'
    | 'durationMs'
    | 'imported'
    | 'validated'
    | 'validatedReady'
    | 'validatedIgnored'
    | 'createdCount'
    | 'updatedCount'
    | 'cancelledCount'
    | 'failedCount'
    | 'skippedCount'
    | 'unchangedCount'
    | 'errorMessage'
    | 'summaryJson'
    | 'createdAt'
    | 'updatedAt'
>;

class IntegrationSyncExecution
    extends Model<IntegrationSyncExecutionAttributes, Creation>
    implements IntegrationSyncExecutionAttributes
{
    public id!: number;
    public provider!: string;
    public triggerSource!: IntegrationSyncTriggerValue | string;
    public mode?: string | null;
    public correlationId!: string;
    public startedAt!: Date;
    public finishedAt?: Date | null;
    public durationMs?: number | null;
    public status!: IntegrationSyncExecutionStatusValue | string;
    public imported?: number | null;
    public validated?: number | null;
    public validatedReady?: number | null;
    public validatedIgnored?: number | null;
    public createdCount?: number | null;
    public updatedCount?: number | null;
    public cancelledCount?: number | null;
    public failedCount?: number | null;
    public skippedCount?: number | null;
    public unchangedCount?: number | null;
    public errorMessage?: string | null;
    public summaryJson?: object | null;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        IntegrationSyncExecution.init(
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
                triggerSource: {
                    type: DataTypes.STRING(20),
                    allowNull: false,
                },
                mode: { type: DataTypes.STRING(20), allowNull: true },
                correlationId: {
                    type: DataTypes.STRING(64),
                    allowNull: false,
                },
                startedAt: { type: DataTypes.DATE, allowNull: false },
                finishedAt: { type: DataTypes.DATE, allowNull: true },
                durationMs: { type: DataTypes.INTEGER, allowNull: true },
                status: { type: DataTypes.STRING(20), allowNull: false },
                imported: { type: DataTypes.INTEGER, allowNull: true },
                validated: { type: DataTypes.INTEGER, allowNull: true },
                validatedReady: { type: DataTypes.INTEGER, allowNull: true },
                validatedIgnored: { type: DataTypes.INTEGER, allowNull: true },
                createdCount: { type: DataTypes.INTEGER, allowNull: true },
                updatedCount: { type: DataTypes.INTEGER, allowNull: true },
                cancelledCount: { type: DataTypes.INTEGER, allowNull: true },
                failedCount: { type: DataTypes.INTEGER, allowNull: true },
                skippedCount: { type: DataTypes.INTEGER, allowNull: true },
                unchangedCount: { type: DataTypes.INTEGER, allowNull: true },
                errorMessage: { type: DataTypes.TEXT, allowNull: true },
                summaryJson: { type: DataTypes.JSON, allowNull: true },
            },
            {
                sequelize,
                modelName: 'IntegrationSyncExecution',
                tableName: 'integration_sync_execution',
                freezeTableName: true,
                timestamps: true,
                underscored: true,
            }
        );
    }
}

export const IntegrationSyncExecutionInit = (sequelize: Sequelize) => {
    IntegrationSyncExecution.initialize(sequelize);
};

export { IntegrationSyncExecution };
