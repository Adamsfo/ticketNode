import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface HospedinSyncLogAttributes {
    id: number;
    operacao: string;
    endpoint: string | null;
    metodo: string | null;
    request_json: object | null;
    response_json: object | null;
    status: number | null;
    duracao_ms: number | null;
    sucesso: boolean;
    erro: string | null;
    data: Date;
}

interface HospedinSyncLogCreationAttributes
    extends Optional<
        HospedinSyncLogAttributes,
        | 'id'
        | 'endpoint'
        | 'metodo'
        | 'request_json'
        | 'response_json'
        | 'status'
        | 'duracao_ms'
        | 'erro'
    > {}

class HospedinSyncLogModel
    extends Model<HospedinSyncLogAttributes, HospedinSyncLogCreationAttributes>
    implements HospedinSyncLogAttributes
{
    public id!: number;
    public operacao!: string;
    public endpoint!: string | null;
    public metodo!: string | null;
    public request_json!: object | null;
    public response_json!: object | null;
    public status!: number | null;
    public duracao_ms!: number | null;
    public sucesso!: boolean;
    public erro!: string | null;
    public data!: Date;

    static initialize(sequelize: Sequelize) {
        HospedinSyncLogModel.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                operacao: {
                    type: DataTypes.STRING(80),
                    allowNull: false,
                },
                endpoint: {
                    type: DataTypes.STRING(512),
                    allowNull: true,
                },
                metodo: {
                    type: DataTypes.STRING(16),
                    allowNull: true,
                },
                request_json: {
                    type: DataTypes.JSON,
                    allowNull: true,
                },
                response_json: {
                    type: DataTypes.JSON,
                    allowNull: true,
                },
                status: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                },
                duracao_ms: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                },
                sucesso: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: false,
                },
                erro: {
                    type: DataTypes.TEXT,
                    allowNull: true,
                },
                data: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
            },
            {
                sequelize,
                modelName: 'HospedinSyncLog',
                tableName: 'hospedin_sync_log',
                freezeTableName: true,
            }
        );
    }

    static associate() {}
}

export const HospedinSyncLogInit = (sequelize: Sequelize) => {
    HospedinSyncLogModel.initialize(sequelize);
    HospedinSyncLogModel.associate();
};

export { HospedinSyncLogModel as HospedinSyncLog };
