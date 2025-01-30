import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface CidadeAttributes {
    id: number;
    descricao: string;
    uf: string;
}

interface CidadeCreationAttributes extends Optional<CidadeAttributes, 'id'> { }

class Cidade extends Model<CidadeAttributes, CidadeCreationAttributes> implements CidadeAttributes {
    public id!: number;
    public descricao!: string;
    public uf!: string;

    static initialize(sequelize: Sequelize) {
        Cidade.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            descricao: {
                type: DataTypes.STRING,
                allowNull: false
            },
            uf: {
                type: DataTypes.STRING,
                allowNull: false,
                validate: {
                    len: [2, 2]
                }
            }
        }, {
            sequelize,
            modelName: "Cidade",
            freezeTableName: true,
            timestamps: false,
            hooks: {
                beforeSave: (cidade) => {
                    if (cidade.uf) {
                        cidade.uf = cidade.uf.toUpperCase();
                    }
                }
            }
        });
    }
}

export const CidadeInit = (sequelize: Sequelize) => {
    Cidade.initialize(sequelize);
}

export {
    Cidade,
};
