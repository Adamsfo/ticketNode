import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { TipoIngresso } from './TipoIngresso';
import { Evento } from './Evento';
import { Ingresso } from './Ingresso';
import { CupomPromocional } from './CupomPromocional';

enum Status {
    Disponivel = 'Ativo',
    Oculto = 'Oculto',
    Finalizado = 'Finalizado',
    PDV = 'PDV'
}

interface EventoIngressoAttributes {
    id: number;
    nome: string;
    descricao?: string;
    idTipoIngresso: number;
    idEvento: number;
    qtde: number;
    preco: number;
    taxaServico: number;
    valor: number;
    lote?: string;
    status: Status;
    idCupomPromocional?: number;
}

interface EventoIngressoCreationAttributes extends Optional<EventoIngressoAttributes, 'id'> { }

class EventoIngresso extends Model<EventoIngressoAttributes, EventoIngressoCreationAttributes> implements EventoIngressoAttributes {
    public id!: number;
    public nome!: string;
    public descricao?: string;
    public idTipoIngresso!: number;
    public idEvento!: number;
    public qtde!: number;
    public preco!: number;
    public taxaServico!: number;
    public valor!: number;
    public lote?: string;
    public status!: Status;
    public idCupomPromocional?: number;

    static initialize(sequelize: Sequelize) {
        EventoIngresso.init({
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
            idTipoIngresso: {
                type: DataTypes.INTEGER,
                references: {
                    model: TipoIngresso,
                    key: 'id'
                }
            },
            idEvento: {
                type: DataTypes.INTEGER,
                references: {
                    model: Evento,
                    key: 'id'
                }
            },
            qtde: {
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
            lote: {
                type: DataTypes.STRING,
                allowNull: true
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
                    model: CupomPromocional, // Assuming you have a CupomPromocional model
                    key: 'id'
                }
            }
        }, {
            sequelize,
            modelName: "EventoIngresso",
            freezeTableName: true,
        });
    }

    static associate() {
        EventoIngresso.belongsTo(TipoIngresso, {
            foreignKey: 'idTipoIngresso',
            as: 'TipoIngresso'
        });
        EventoIngresso.belongsTo(Evento, {
            foreignKey: 'idEvento',
            as: 'Evento'
        });
        EventoIngresso.belongsTo(CupomPromocional, {
            foreignKey: 'idCupomPromocional',
            as: 'CupomPromocional'
        });

        // EventoIngresso.hasMany(Ingresso, {
        //     foreignKey: 'idEvento',
        //     as: 'Ingresso'
        // });
    }
}

export const EventoIngressoInit = (sequelize: Sequelize) => {
    EventoIngresso.initialize(sequelize);
    EventoIngresso.associate();
}

export {
    EventoIngresso,
};
