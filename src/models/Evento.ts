import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

enum Status {
    Disponivel = 'Ativo',
    Oculto = 'Oculto',
    Finalizado = 'Finalizado'
}

interface EventoAttributes {
    id: number;
    nome: string;
    descricao?: string;
    imagem?: string;
    mapa?: string;
    data_hora_inicio: Date;
    data_hora_fim: Date;
    latitude?: string;
    longitude?: string;
    endereco: string;
    idUsuario: number;
    idProdutor: number;
    status?: Status;
}

interface EventoCreationAttributes extends Optional<EventoAttributes, 'id'> { }

class Evento extends Model<EventoAttributes, EventoCreationAttributes> implements EventoAttributes {
    public id!: number;
    public nome!: string;
    public descricao!: string;
    public imagem!: string;
    public mapa!: string;
    public data_hora_inicio!: Date;
    public data_hora_fim!: Date;
    public latitude?: string;
    public longitude?: string;
    public endereco!: string;
    public idUsuario!: number;
    public idProdutor!: number;
    public status!: Status;

    static initialize(sequelize: Sequelize) {
        Evento.init({
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
                type: DataTypes.TEXT,
                allowNull: true
            },
            imagem: {
                type: DataTypes.STRING,
                allowNull: true
            },
            mapa: {
                type: DataTypes.STRING,
                allowNull: true
            },
            data_hora_inicio: {
                type: DataTypes.DATE,
                allowNull: false,
                get() {
                    const rawValue = this.getDataValue('data_hora_inicio');
                    return rawValue ? new Date(rawValue) : null;
                }
            },
            data_hora_fim: {
                type: DataTypes.DATE,
                allowNull: false,
                get() {
                    const rawValue = this.getDataValue('data_hora_fim');
                    return rawValue ? new Date(rawValue) : null;
                }
            },
            latitude: {
                type: DataTypes.STRING,
                allowNull: false
            },
            longitude: {
                type: DataTypes.STRING,
                allowNull: false
            },
            endereco: {
                type: DataTypes.STRING,
                allowNull: false
            },
            idUsuario: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            idProdutor: {
                type: DataTypes.INTEGER,
                allowNull: false
            },
            status: {
                type: DataTypes.ENUM,
                values: ['Ativo', 'Oculto', 'Finalizado'],
                defaultValue: 'Oculto'
            }
        }, {
            sequelize,
            modelName: "Evento",
            freezeTableName: true,
            timestamps: false,
        });
    }
}

export const EventoInit = (sequelize: Sequelize) => {
    Evento.initialize(sequelize);
}

export {
    Evento,
};
