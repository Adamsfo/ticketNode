import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface ProdutorAttributes {
    id: number;
    nome: string;
    descricao?: string;
    logo?: string;
}

interface ProdutorCreationAttributes extends Optional<ProdutorAttributes, 'id'> { }

class Produtor extends Model<ProdutorAttributes, ProdutorCreationAttributes> implements ProdutorAttributes {
    public id!: number;
    public nome!: string;
    public descricao!: string;
    public logo!: string;

    static initialize(sequelize: Sequelize) {
        Produtor.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            nome: {
                type: DataTypes.STRING,
                allowNull: false
            },
            descricao: {
                type: DataTypes.STRING,
                allowNull: true
            },
            logo: {
                type: DataTypes.STRING,
                allowNull: true
            }
        }, {
            sequelize,
            modelName: "Produtor",
            freezeTableName: true,
            timestamps: false,
        });
    }
}

export const ProdutorInit = (sequelize: Sequelize) => {
    Produtor.initialize(sequelize);
}

export {
    Produtor,
};
