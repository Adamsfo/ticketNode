import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { ReservaHospedagem } from './ReservaHospedagem';
import { Usuario } from './Usuario';

export const TipoMovimentacaoPeriodo = {
    ALTERACAO: 'ALTERACAO',
} as const;

export type TipoMovimentacaoPeriodoValor =
    (typeof TipoMovimentacaoPeriodo)[keyof typeof TipoMovimentacaoPeriodo];

interface ReservaPeriodoMovimentacaoAttributes {
    id: number;
    idReservaHospedagem: number;
    idUsuario: number;
    dataHora: Date;
    checkinAnterior: Date;
    checkoutAnterior: Date;
    checkinNovo: Date;
    checkoutNovo: Date;
    motivo: string | null;
    tipo: TipoMovimentacaoPeriodoValor | string;
}

interface ReservaPeriodoMovimentacaoCreationAttributes
    extends Optional<
        ReservaPeriodoMovimentacaoAttributes,
        'id' | 'motivo' | 'tipo'
    > {}

class ReservaPeriodoMovimentacao
    extends Model<
        ReservaPeriodoMovimentacaoAttributes,
        ReservaPeriodoMovimentacaoCreationAttributes
    >
    implements ReservaPeriodoMovimentacaoAttributes
{
    public id!: number;
    public idReservaHospedagem!: number;
    public idUsuario!: number;
    public dataHora!: Date;
    public checkinAnterior!: Date;
    public checkoutAnterior!: Date;
    public checkinNovo!: Date;
    public checkoutNovo!: Date;
    public motivo!: string | null;
    public tipo!: TipoMovimentacaoPeriodoValor | string;

    static initialize(sequelize: Sequelize) {
        ReservaPeriodoMovimentacao.init(
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
                idUsuario: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: { model: Usuario, key: 'id' },
                },
                dataHora: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                checkinAnterior: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                checkoutAnterior: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                checkinNovo: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                checkoutNovo: {
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
                    defaultValue: TipoMovimentacaoPeriodo.ALTERACAO,
                },
            },
            {
                sequelize,
                modelName: 'ReservaPeriodoMovimentacao',
                freezeTableName: true,
            }
        );
    }

    static associate() {
        ReservaPeriodoMovimentacao.belongsTo(ReservaHospedagem, {
            foreignKey: 'idReservaHospedagem',
            as: 'ReservaHospedagem',
        });
        ReservaPeriodoMovimentacao.belongsTo(Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario',
        });
        ReservaHospedagem.hasMany(ReservaPeriodoMovimentacao, {
            foreignKey: 'idReservaHospedagem',
            as: 'MovimentacoesPeriodo',
        });
    }
}

export const ReservaPeriodoMovimentacaoInit = (sequelize: Sequelize) => {
    ReservaPeriodoMovimentacao.initialize(sequelize);
    ReservaPeriodoMovimentacao.associate();
};

export { ReservaPeriodoMovimentacao };
