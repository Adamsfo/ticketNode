import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { Usuario } from './Usuario';

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
        });
    }
}

enum TipoAcesso {
    Administrador = 'Administrador',
    Validador = 'Validador',
}

interface ProdutorAcessoAttributes {
    id: number;
    idProdutor: number;
    tipoAcesso: TipoAcesso;
    idUsuario: number;
}

interface ProdutorAcessoCreationAttributes extends Optional<ProdutorAcessoAttributes, 'id'> { }

class ProdutorAcesso extends Model<ProdutorAcessoAttributes, ProdutorAcessoCreationAttributes> implements ProdutorAcessoAttributes {
    public id!: number;
    public idProdutor!: number;
    public tipoAcesso!: TipoAcesso;
    public idUsuario!: number;

    static initialize(sequelize: Sequelize) {
        ProdutorAcesso.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idProdutor: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            tipoAcesso: {
                type: DataTypes.ENUM(...Object.values(TipoAcesso)),
                allowNull: false
            },
            idUsuario: {
                type: DataTypes.INTEGER,
                allowNull: false
            }
        }, {
            sequelize,
            modelName: "ProdutorAcesso",
            freezeTableName: true,
        });
    }

    static associate(models: any) {
        ProdutorAcesso.belongsTo(models.Produtor, {
            foreignKey: 'idProdutor',
            as: 'Produtor'
        });
        ProdutorAcesso.belongsTo(models.Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario'
        });
    }
}

export const ProdutorInit = (sequelize: Sequelize) => {
    Produtor.initialize(sequelize);
    ProdutorAcesso.initialize(sequelize);
    ProdutorAcesso.associate({ Produtor, Usuario });
}

export {
    Produtor,
    ProdutorAcesso,
    TipoAcesso,
};
