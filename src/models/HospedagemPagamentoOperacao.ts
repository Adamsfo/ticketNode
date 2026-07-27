import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { ReservaHospedagem } from './ReservaHospedagem';
import { Usuario } from './Usuario';

export const HospedagemPagamentoOperacaoTipo = {
    HOSPEDAGEM: 'HOSPEDAGEM',
} as const;

export const HospedagemPagamentoOperacaoOrigem = {
    RECEBER_SALDO: 'RECEBER_SALDO',
} as const;

export const HospedagemPagamentoOperacaoStatus = {
    PENDENTE: 'PENDENTE',
    ENVIADO_PINPAD: 'ENVIADO_PINPAD',
    APROVADO: 'APROVADO',
    REGISTRADO: 'REGISTRADO',
    CANCELADO: 'CANCELADO',
    ERRO: 'ERRO',
} as const;

export type StatusHospedagemPagamentoOperacao =
    (typeof HospedagemPagamentoOperacaoStatus)[keyof typeof HospedagemPagamentoOperacaoStatus];

interface HospedagemPagamentoOperacaoAttributes {
    id: number;
    uuid: string;
    tipo: string;
    origem: string;
    idReservaHospedagem: number;
    idUsuario: number;
    valor: number;
    formaPagamento: string;
    status: StatusHospedagemPagamentoOperacao | string;
    orderIdSuperTef: string;
    idExternoSuperTef?: string | null;
    observacao?: string | null;
    mensagemStatus?: string | null;
    rawInicio?: string | null;
    idPagamentoHospedagem?: number | null;
}

interface HospedagemPagamentoOperacaoCreationAttributes
    extends Optional<
        HospedagemPagamentoOperacaoAttributes,
        | 'id'
        | 'tipo'
        | 'origem'
        | 'status'
        | 'idExternoSuperTef'
        | 'observacao'
        | 'mensagemStatus'
        | 'rawInicio'
        | 'idPagamentoHospedagem'
    > {}

class HospedagemPagamentoOperacao
    extends Model<
        HospedagemPagamentoOperacaoAttributes,
        HospedagemPagamentoOperacaoCreationAttributes
    >
    implements HospedagemPagamentoOperacaoAttributes
{
    public id!: number;
    public uuid!: string;
    public tipo!: string;
    public origem!: string;
    public idReservaHospedagem!: number;
    public idUsuario!: number;
    public valor!: number;
    public formaPagamento!: string;
    public status!: StatusHospedagemPagamentoOperacao | string;
    public orderIdSuperTef!: string;
    public idExternoSuperTef?: string | null;
    public observacao?: string | null;
    public mensagemStatus?: string | null;
    public rawInicio?: string | null;
    public idPagamentoHospedagem?: number | null;

    static initialize(sequelize: Sequelize) {
        HospedagemPagamentoOperacao.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                uuid: {
                    type: DataTypes.STRING(64),
                    allowNull: false,
                    unique: true,
                },
                tipo: {
                    type: DataTypes.STRING(30),
                    allowNull: false,
                    defaultValue: HospedagemPagamentoOperacaoTipo.HOSPEDAGEM,
                },
                origem: {
                    type: DataTypes.STRING(40),
                    allowNull: false,
                    defaultValue:
                        HospedagemPagamentoOperacaoOrigem.RECEBER_SALDO,
                },
                idReservaHospedagem: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: 'ReservaHospedagem',
                        key: 'id',
                    },
                },
                idUsuario: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: 'Usuario',
                        key: 'id',
                    },
                },
                valor: {
                    type: DataTypes.DECIMAL(14, 2),
                    allowNull: false,
                },
                formaPagamento: {
                    type: DataTypes.STRING(40),
                    allowNull: false,
                },
                status: {
                    type: DataTypes.STRING(30),
                    allowNull: false,
                    defaultValue: HospedagemPagamentoOperacaoStatus.PENDENTE,
                },
                orderIdSuperTef: {
                    type: DataTypes.STRING(64),
                    allowNull: false,
                    unique: true,
                },
                idExternoSuperTef: {
                    type: DataTypes.STRING(120),
                    allowNull: true,
                },
                observacao: {
                    type: DataTypes.TEXT,
                    allowNull: true,
                },
                mensagemStatus: {
                    type: DataTypes.STRING(255),
                    allowNull: true,
                },
                rawInicio: {
                    type: DataTypes.TEXT,
                    allowNull: true,
                },
                idPagamentoHospedagem: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                },
            },
            {
                sequelize,
                modelName: 'HospedagemPagamentoOperacao',
                freezeTableName: true,
            }
        );
    }

    static associate() {
        HospedagemPagamentoOperacao.belongsTo(ReservaHospedagem, {
            foreignKey: 'idReservaHospedagem',
            as: 'ReservaHospedagem',
        });
        HospedagemPagamentoOperacao.belongsTo(Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario',
        });
    }
}

export const HospedagemPagamentoOperacaoInit = (sequelize: Sequelize) => {
    HospedagemPagamentoOperacao.initialize(sequelize);
    HospedagemPagamentoOperacao.associate();
};

export { HospedagemPagamentoOperacao };
