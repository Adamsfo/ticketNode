import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface TipoIngressoAttributes {
    id: number;
    descricao: string;
    qtde: number;
}

interface TipoIngressoCreationAttributes extends Optional<TipoIngressoAttributes, 'id'> { }

class TipoIngresso extends Model<TipoIngressoAttributes, TipoIngressoCreationAttributes> implements TipoIngressoAttributes {
    public id!: number;
    public descricao!: string;
    public qtde!: number;

    static initialize(sequelize: Sequelize) {
        TipoIngresso.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            descricao: {
                type: DataTypes.STRING,
                allowNull: false
            },
            qtde: {
                type: DataTypes.INTEGER
            }
        }, {
            sequelize,
            modelName: "TipoIngresso",
            freezeTableName: true,
        });
    }
}

export const TipoIngressoInit = (sequelize: Sequelize) => {
    TipoIngresso.initialize(sequelize);
}

export {
    TipoIngresso,
};
