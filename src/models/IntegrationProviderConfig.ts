import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface IntegrationProviderConfigAttributes {
    id: number;
    provider: string;
    displayName: string;
    enabled: boolean;
    intervalMinutes: number;
    mode: string;
    syncLimit: number;
    priority: number;
    maxRetries: number;
    backoffBaseSeconds: number;
    webhookEnabled: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

type Creation = Optional<
    IntegrationProviderConfigAttributes,
    | 'id'
    | 'enabled'
    | 'intervalMinutes'
    | 'mode'
    | 'syncLimit'
    | 'priority'
    | 'maxRetries'
    | 'backoffBaseSeconds'
    | 'webhookEnabled'
    | 'createdAt'
    | 'updatedAt'
>;

class IntegrationProviderConfig
    extends Model<IntegrationProviderConfigAttributes, Creation>
    implements IntegrationProviderConfigAttributes
{
    public id!: number;
    public provider!: string;
    public displayName!: string;
    public enabled!: boolean;
    public intervalMinutes!: number;
    public mode!: string;
    public syncLimit!: number;
    public priority!: number;
    public maxRetries!: number;
    public backoffBaseSeconds!: number;
    public webhookEnabled!: boolean;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        IntegrationProviderConfig.init(
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
                displayName: {
                    type: DataTypes.STRING(80),
                    allowNull: false,
                },
                enabled: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: false,
                },
                intervalMinutes: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 5,
                },
                mode: {
                    type: DataTypes.STRING(20),
                    allowNull: false,
                    defaultValue: 'incremental',
                },
                syncLimit: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 50,
                },
                priority: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 100,
                },
                maxRetries: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 2,
                },
                backoffBaseSeconds: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    defaultValue: 30,
                },
                webhookEnabled: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: false,
                },
            },
            {
                sequelize,
                modelName: 'IntegrationProviderConfig',
                tableName: 'integration_provider_config',
                freezeTableName: true,
                timestamps: true,
                underscored: true,
            }
        );
    }
}

export const IntegrationProviderConfigInit = (sequelize: Sequelize) => {
    IntegrationProviderConfig.initialize(sequelize);
};

export { IntegrationProviderConfig };
