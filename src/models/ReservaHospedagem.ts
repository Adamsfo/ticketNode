import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { Evento } from './Evento';
import { Usuario } from './Usuario';
import { Transacao } from './Transacao';
export enum StatusReservaHospedagem {
    AguardandoPagamento = 'AguardandoPagamento',
    Confirmada = 'Confirmada',
    Cancelada = 'Cancelada',
    Expirada = 'Expirada',
}

interface ReservaHospedagemAttributes {
    id: number;
    idEvento: number;
    idUsuario: number;
    checkin: Date;
    checkout: Date;
    noites: number;
    preco: number;
    taxaServico: number;
    valorTotal: number;
    status: StatusReservaHospedagem;
    idTransacao?: number | null;
    dataConfirmacao?: Date | null;
}

interface ReservaHospedagemCreationAttributes
    extends Optional<
        ReservaHospedagemAttributes,
        'id' | 'idTransacao' | 'status' | 'dataConfirmacao'
    > {}

class ReservaHospedagem
    extends Model<ReservaHospedagemAttributes, ReservaHospedagemCreationAttributes>
    implements ReservaHospedagemAttributes {

    public id!: number;
    public idEvento!: number;
    public idUsuario!: number;
    public checkin!: Date;
    public checkout!: Date;
    public noites!: number;
    public preco!: number;
    public taxaServico!: number;
    public valorTotal!: number;
    public status!: StatusReservaHospedagem;
    public idTransacao?: number | null;
    public dataConfirmacao?: Date | null;

    static initialize(sequelize: Sequelize) {
        ReservaHospedagem.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            idEvento: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: Evento, key: 'id' },
            },
            idUsuario: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: Usuario, key: 'id' },
            },
            checkin: {
                type: DataTypes.DATE,
                allowNull: false,
            },
            checkout: {
                type: DataTypes.DATE,
                allowNull: false,
            },
            noites: {
                type: DataTypes.INTEGER,
                allowNull: false,
                validate: { isInt: true, min: 1 },
            },
            preco: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
            },
            taxaServico: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
            },
            valorTotal: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
            },
            status: {
                type: DataTypes.ENUM(...Object.values(StatusReservaHospedagem)),
                allowNull: false,
                defaultValue: StatusReservaHospedagem.AguardandoPagamento,
            },
            idTransacao: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: Transacao, key: 'id' },
            },
            dataConfirmacao: {
                type: DataTypes.DATE,
                allowNull: true,
            },
        }, {
            sequelize,
            modelName: 'ReservaHospedagem',
            freezeTableName: true,
        });
    }

    static associate() {
        ReservaHospedagem.belongsTo(Evento, {
            foreignKey: 'idEvento',
            as: 'Evento',
        });
        ReservaHospedagem.belongsTo(Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario',
        });
        ReservaHospedagem.belongsTo(Transacao, {
            foreignKey: 'idTransacao',
            as: 'Transacao',
        });
    }
}

export const ReservaHospedagemInit = (sequelize: Sequelize) => {
    ReservaHospedagem.initialize(sequelize);
    ReservaHospedagem.associate();
};

export { ReservaHospedagem };
