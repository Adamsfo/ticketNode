import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { ReservaHospedagem } from './ReservaHospedagem';
import { ReservaSuite } from './ReservaSuite';
import { EventoSuite } from './EventoSuite';
import { Usuario } from './Usuario';

export const TipoMovimentacaoSuite = {
    TRANSFERENCIA: 'TRANSFERENCIA',
} as const;

export type TipoMovimentacaoSuiteValor =
    (typeof TipoMovimentacaoSuite)[keyof typeof TipoMovimentacaoSuite];

interface ReservaSuiteMovimentacaoAttributes {
    id: number;
    idReservaHospedagem: number;
    idReservaSuite: number;
    idEventoSuiteOrigem: number;
    idEventoSuiteDestino: number;
    idUsuario: number;
    dataHora: Date;
    motivo: string | null;
    tipo: TipoMovimentacaoSuiteValor | string;
}

interface ReservaSuiteMovimentacaoCreationAttributes
    extends Optional<
        ReservaSuiteMovimentacaoAttributes,
        'id' | 'motivo' | 'tipo'
    > {}

class ReservaSuiteMovimentacao
    extends Model<
        ReservaSuiteMovimentacaoAttributes,
        ReservaSuiteMovimentacaoCreationAttributes
    >
    implements ReservaSuiteMovimentacaoAttributes
{
    public id!: number;
    public idReservaHospedagem!: number;
    public idReservaSuite!: number;
    public idEventoSuiteOrigem!: number;
    public idEventoSuiteDestino!: number;
    public idUsuario!: number;
    public dataHora!: Date;
    public motivo!: string | null;
    public tipo!: TipoMovimentacaoSuiteValor | string;

    static initialize(sequelize: Sequelize) {
        ReservaSuiteMovimentacao.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                idReservaHospedagem: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: { model: ReservaHospedagem, key: 'id' },
                },
                idReservaSuite: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: { model: ReservaSuite, key: 'id' },
                },
                idEventoSuiteOrigem: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: { model: EventoSuite, key: 'id' },
                },
                idEventoSuiteDestino: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: { model: EventoSuite, key: 'id' },
                },
                idUsuario: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: { model: Usuario, key: 'id' },
                },
                dataHora: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                motivo: {
                    type: DataTypes.STRING(255),
                    allowNull: true,
                },
                tipo: {
                    type: DataTypes.STRING(40),
                    allowNull: false,
                    defaultValue: TipoMovimentacaoSuite.TRANSFERENCIA,
                },
            },
            {
                sequelize,
                modelName: 'ReservaSuiteMovimentacao',
                freezeTableName: true,
            }
        );
    }

    static associate() {
        ReservaSuiteMovimentacao.belongsTo(ReservaHospedagem, {
            foreignKey: 'idReservaHospedagem',
            as: 'ReservaHospedagem',
        });
        ReservaSuiteMovimentacao.belongsTo(ReservaSuite, {
            foreignKey: 'idReservaSuite',
            as: 'ReservaSuite',
        });
        ReservaSuiteMovimentacao.belongsTo(EventoSuite, {
            foreignKey: 'idEventoSuiteOrigem',
            as: 'SuiteOrigem',
        });
        ReservaSuiteMovimentacao.belongsTo(EventoSuite, {
            foreignKey: 'idEventoSuiteDestino',
            as: 'SuiteDestino',
        });
        ReservaSuiteMovimentacao.belongsTo(Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario',
        });
        ReservaHospedagem.hasMany(ReservaSuiteMovimentacao, {
            foreignKey: 'idReservaHospedagem',
            as: 'MovimentacoesSuite',
        });
    }
}

export const ReservaSuiteMovimentacaoInit = (sequelize: Sequelize) => {
    ReservaSuiteMovimentacao.initialize(sequelize);
    ReservaSuiteMovimentacao.associate();
};

export { ReservaSuiteMovimentacao };
