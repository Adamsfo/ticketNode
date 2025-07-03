import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { Usuario } from './Usuario';
import { Produtor } from './Produtor';
import { EventoIngresso } from './EventoIngresso';

enum TipoDesconto {
    Nenhum = 'Nenhum',
    Percentual = 'Percentual',
    Fixo = 'Fixo',
}

interface CupomPromocionalAttributes {
    id: number;
    nome: string;
    idProdutor: number;
    tipoDesconto: TipoDesconto; // Exemplo: 'percentual', 'valor_fixo'
    valorDesconto: number; // Valor do desconto, se aplicável
    valorDescontoTaxa?: number; // Valor do desconto aplicado na taxa de serviço, se aplicável
}

interface CupomPromocionalCreationAttributes extends Optional<CupomPromocionalAttributes, 'id'> { }

class CupomPromocional extends Model<CupomPromocionalAttributes, CupomPromocionalCreationAttributes> implements CupomPromocionalAttributes {
    public id!: number;
    public nome!: string;
    public idProdutor!: number;
    public tipoDesconto!: TipoDesconto;
    public valorDesconto!: number; // Valor do desconto, se aplicável
    public valorDescontoTaxa?: number; // Valor do desconto aplicado na taxa de serviço, se aplicável

    static initialize(sequelize: Sequelize) {
        CupomPromocional.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            nome: {
                type: DataTypes.STRING,
                allowNull: false
            },
            idProdutor: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            tipoDesconto: {
                type: DataTypes.ENUM,
                values: Object.values(TipoDesconto),
                allowNull: false,
                defaultValue: TipoDesconto.Percentual // Valor padrão
            },
            valorDesconto: {
                type: DataTypes.FLOAT,
                allowNull: false,
                defaultValue: 0 // Valor padrão
            },
            valorDescontoTaxa: {
                type: DataTypes.FLOAT,
                allowNull: true, // Pode ser nulo se não houver desconto na taxa
                defaultValue: 0 // Valor padrão
            }
        }, {
            sequelize,
            modelName: "CupomPromocional",
            freezeTableName: true,
        });
    }

    static associate(models: any) {
        CupomPromocional.belongsTo(models.Produtor, {
            foreignKey: 'idProdutor',
            as: 'Produtor'
        });
        CupomPromocional.hasMany(models.CupomPromocionalValidade, {
            foreignKey: 'idCupomPromocional',
            as: 'CupomPromocionalValidade'
        });
        // CupomPromocional.hasMany(models.Ingresso, {
        //     foreignKey: 'idCupomPromocional',
        //     as: 'EventoIngresso'
        // });
    }
}

interface CupomPromocionalValidadeAttributes {
    id: number;
    idCupomPromocional: number;
    dataInicial: Date;
    dataFinal: Date;
}

interface CupomPromocionalValidadeCreationAttributes extends Optional<CupomPromocionalValidadeAttributes, 'id'> { }

class CupomPromocionalValidade extends Model<CupomPromocionalValidadeAttributes, CupomPromocionalValidadeCreationAttributes> implements CupomPromocionalValidadeAttributes {
    public id!: number;
    public idCupomPromocional!: number;
    public dataInicial!: Date;
    public dataFinal!: Date;

    static initialize(sequelize: Sequelize) {
        CupomPromocionalValidade.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idCupomPromocional: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            dataInicial: {
                type: DataTypes.DATE,
                allowNull: false
            },
            dataFinal: {
                type: DataTypes.DATE,
                allowNull: false
            }
        }, {
            sequelize,
            modelName: "CupomPromocionalValidade",
            freezeTableName: true,
        });
    }

    static associate(models: any) {
        CupomPromocionalValidade.belongsTo(models.CupomPromocional, {
            foreignKey: 'idCupomPromocional',
            as: 'CupomPromocional'
        });
    }
}

export const CupomPromocionalInit = (sequelize: Sequelize) => {
    CupomPromocional.initialize(sequelize);
    CupomPromocionalValidade.initialize(sequelize);
    CupomPromocional.associate({ Produtor, CupomPromocionalValidade, EventoIngresso });
    CupomPromocionalValidade.associate({ CupomPromocional });
}

export {
    CupomPromocional,
    CupomPromocionalValidade,
    TipoDesconto,
};
