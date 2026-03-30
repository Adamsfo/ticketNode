import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { Evento } from './Evento';
import { CupomPromocional } from './CupomPromocional';

enum Status {
    Disponivel = 'Ativo',
    Oculto = 'Oculto',
}

interface EventoSuiteAttributes {
    id: number;
    nome: string;
    descricao?: string;
    idEvento: number;
    preco: number;
    taxaServico: number;
    valor: number;
    qtdeMinimaPessoas?: number;
    qtdeMaximaPessoas?: number;
    status: Status;
    idCupomPromocional?: number;
}

interface EventoSuiteCreationAttributes
    extends Optional<EventoSuiteAttributes, 'id' | 'descricao' | 'idCupomPromocional'> { }

class EventoSuite
    extends Model<EventoSuiteAttributes, EventoSuiteCreationAttributes>
    implements EventoSuiteAttributes {

    public id!: number;
    public nome!: string;
    public descricao?: string;
    public idEvento!: number;
    public qtdeMinimaPessoas?: number;
    public qtdeMaximaPessoas?: number;
    public preco!: number;
    public taxaServico!: number;
    public valor!: number;
    public status!: Status;
    public idCupomPromocional?: number;

    static initialize(sequelize: Sequelize) {
        EventoSuite.init({
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
            idEvento: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: Evento,
                    key: 'id'
                }
            },
            qtdeMinimaPessoas: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            qtdeMaximaPessoas: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            preco: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: false
            },
            taxaServico: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: false
            },
            valor: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: false
            },
            status: {
                type: DataTypes.ENUM,
                values: ['Ativo', 'Oculto', 'Finalizado', 'PDV'],
                defaultValue: 'Oculto'
            },
            idCupomPromocional: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: CupomPromocional,
                    key: 'id'
                }
            }
        }, {
            sequelize,
            modelName: 'EventoSuite',
            freezeTableName: true
        });
    }

    static associate() {
        EventoSuite.belongsTo(Evento, {
            foreignKey: 'idEvento',
            as: 'Evento'
        });

        EventoSuite.belongsTo(CupomPromocional, {
            foreignKey: 'idCupomPromocional',
            as: 'CupomPromocional'
        });
    }
}

export const EventoSuiteInit = (sequelize: Sequelize) => {
    EventoSuite.initialize(sequelize);
    EventoSuite.associate();
};

export {
    EventoSuite
};
