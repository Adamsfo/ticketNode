import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

/**
 * Contador global do RefreshManager da hospedagem.
 * Uma linha (id = 1); version incrementa a cada mutação operacional.
 */
interface HospedagemRefreshStateAttributes {
    id: number;
    version: number;
    updatedAt?: Date;
}

type Creation = Optional<
    HospedagemRefreshStateAttributes,
    'version' | 'updatedAt'
>;

class HospedagemRefreshState
    extends Model<HospedagemRefreshStateAttributes, Creation>
    implements HospedagemRefreshStateAttributes
{
    public id!: number;
    public version!: number;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        HospedagemRefreshState.init(
            {
                id: {
                    type: DataTypes.TINYINT,
                    primaryKey: true,
                    allowNull: false,
                },
                version: {
                    type: DataTypes.BIGINT.UNSIGNED,
                    allowNull: false,
                    defaultValue: 0,
                },
                updatedAt: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
            },
            {
                sequelize,
                modelName: 'HospedagemRefreshState',
                tableName: 'hospedagem_refresh_state',
                freezeTableName: true,
                timestamps: true,
                createdAt: false,
                updatedAt: 'updatedAt',
            }
        );
    }
}

export const HospedagemRefreshStateInit = (sequelize: Sequelize) => {
    HospedagemRefreshState.initialize(sequelize);
};

export { HospedagemRefreshState };
