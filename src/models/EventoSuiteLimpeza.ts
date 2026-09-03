import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { EventoSuite } from './EventoSuite';
import { ReservaHospedagem } from './ReservaHospedagem';
import { ReservaSuite } from './ReservaSuite';
import { Usuario } from './Usuario';

export enum StatusEventoSuiteLimpeza {
    Pendente = 'Pendente',
    EmAndamento = 'EmAndamento',
    Concluida = 'Concluida',
}

export const STATUS_EVENTO_SUITE_LIMPEZA = Object.values(
    StatusEventoSuiteLimpeza
) as StatusEventoSuiteLimpeza[];

/** Pendente ou EmAndamento — único efeito operacional previsto: bloquear check-in (4C). */
export function isLimpezaAberta(status: string): boolean {
    return (
        status === StatusEventoSuiteLimpeza.Pendente ||
        status === StatusEventoSuiteLimpeza.EmAndamento
    );
}

export function podeIniciarLimpeza(status: string): boolean {
    return status === StatusEventoSuiteLimpeza.Pendente;
}

export function podeConcluirLimpeza(status: string): boolean {
    return status === StatusEventoSuiteLimpeza.EmAndamento;
}

interface EventoSuiteLimpezaAttributes {
    id: number;
    idEventoSuite: number;
    idReservaHospedagem: number;
    idReservaSuite: number;
    status: StatusEventoSuiteLimpeza;
    dataHoraInicio: Date | null;
    idUsuarioInicio: number | null;
    dataHoraFim: Date | null;
    idUsuarioFim: number | null;
    createdAt?: Date;
    updatedAt?: Date;
}

interface EventoSuiteLimpezaCreationAttributes
    extends Optional<
        EventoSuiteLimpezaAttributes,
        | 'id'
        | 'status'
        | 'dataHoraInicio'
        | 'idUsuarioInicio'
        | 'dataHoraFim'
        | 'idUsuarioFim'
        | 'createdAt'
        | 'updatedAt'
    > {}

class EventoSuiteLimpeza
    extends Model<EventoSuiteLimpezaAttributes, EventoSuiteLimpezaCreationAttributes>
    implements EventoSuiteLimpezaAttributes
{
    public id!: number;
    public idEventoSuite!: number;
    public idReservaHospedagem!: number;
    public idReservaSuite!: number;
    public status!: StatusEventoSuiteLimpeza;
    public dataHoraInicio!: Date | null;
    public idUsuarioInicio!: number | null;
    public dataHoraFim!: Date | null;
    public idUsuarioFim!: number | null;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        EventoSuiteLimpeza.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                idEventoSuite: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    field: 'id_evento_suite',
                    references: { model: EventoSuite, key: 'id' },
                },
                idReservaHospedagem: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    field: 'id_reserva_hospedagem',
                    references: { model: ReservaHospedagem, key: 'id' },
                },
                idReservaSuite: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    field: 'id_reserva_suite',
                    references: { model: ReservaSuite, key: 'id' },
                },
                status: {
                    type: DataTypes.ENUM(
                        ...Object.values(StatusEventoSuiteLimpeza)
                    ),
                    allowNull: false,
                    defaultValue: StatusEventoSuiteLimpeza.Pendente,
                },
                dataHoraInicio: {
                    type: DataTypes.DATE,
                    allowNull: true,
                    field: 'data_hora_inicio',
                },
                idUsuarioInicio: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                    field: 'id_usuario_inicio',
                    references: { model: Usuario, key: 'id' },
                },
                dataHoraFim: {
                    type: DataTypes.DATE,
                    allowNull: true,
                    field: 'data_hora_fim',
                },
                idUsuarioFim: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                    field: 'id_usuario_fim',
                    references: { model: Usuario, key: 'id' },
                },
            },
            {
                sequelize,
                modelName: 'EventoSuiteLimpeza',
                freezeTableName: true,
                underscored: true,
                indexes: [
                    {
                        name: 'uq_limpeza_reserva_suite',
                        unique: true,
                        fields: ['idReservaHospedagem', 'idEventoSuite'],
                    },
                    {
                        name: 'idx_limpeza_suite_status',
                        fields: ['idEventoSuite', 'status'],
                    },
                    {
                        name: 'idx_limpeza_status',
                        fields: ['status'],
                    },
                ],
            }
        );
    }

    static associate() {
        EventoSuiteLimpeza.belongsTo(EventoSuite, {
            foreignKey: 'idEventoSuite',
            as: 'EventoSuite',
        });
        EventoSuiteLimpeza.belongsTo(ReservaHospedagem, {
            foreignKey: 'idReservaHospedagem',
            as: 'ReservaHospedagem',
        });
        EventoSuiteLimpeza.belongsTo(ReservaSuite, {
            foreignKey: 'idReservaSuite',
            as: 'ReservaSuite',
        });
        EventoSuiteLimpeza.belongsTo(Usuario, {
            foreignKey: 'idUsuarioInicio',
            as: 'UsuarioInicio',
        });
        EventoSuiteLimpeza.belongsTo(Usuario, {
            foreignKey: 'idUsuarioFim',
            as: 'UsuarioFim',
        });

        EventoSuite.hasMany(EventoSuiteLimpeza, {
            foreignKey: 'idEventoSuite',
            as: 'Limpezas',
        });
        ReservaHospedagem.hasMany(EventoSuiteLimpeza, {
            foreignKey: 'idReservaHospedagem',
            as: 'Limpezas',
        });
        ReservaSuite.hasMany(EventoSuiteLimpeza, {
            foreignKey: 'idReservaSuite',
            as: 'Limpezas',
        });
    }
}

export const EventoSuiteLimpezaInit = (sequelize: Sequelize) => {
    EventoSuiteLimpeza.initialize(sequelize);
    EventoSuiteLimpeza.associate();
};

export { EventoSuiteLimpeza };
