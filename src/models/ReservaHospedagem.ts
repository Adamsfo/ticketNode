import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { Evento } from './Evento';
import { Usuario } from './Usuario';
import { Transacao } from './Transacao';
export enum StatusReservaHospedagem {
    AguardandoPagamento = 'AguardandoPagamento',
    Confirmada = 'Confirmada',
    Hospedada = 'Hospedada',
    CheckOutRealizado = 'CheckOutRealizado',
    Cancelada = 'Cancelada',
    Expirada = 'Expirada',
}

/** Valores conhecidos de origem_reserva / origemReserva (produção + legado). */
export type OrigemReservaHospedagem =
    | 'CLIENTE'
    | 'ATENDENTE'
    | 'SITE' // legado em alguns ambientes
    | 'LINK_CLIENTE'
    | 'BOOKING'
    | 'AIRBNB'
    | 'EXPEDIA'
    | 'HOSPEDIN';

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
    valorPago?: number;
    saldoPendente?: number | null;
    formaPagamentoRecepcao?: string | null;
    observacaoPagamento?: string | null;
    comprovantePagamento?: string | null;
    /**
     * Origem da reserva (VARCHAR no banco — não usar ENUM).
     * Valores já existentes em produção: CLIENTE | ATENDENTE.
     * Aceita futuras origens (SITE legado, LINK_CLIENTE, BOOKING, AIRBNB, etc.).
     */
    origemReserva?: OrigemReservaHospedagem | string;
    /** ID primário na origem (ex.: reservation_id Hospedin). */
    idExterno?: string | null;
    /** Código humano na origem (ex.: searchable_code). */
    codigoExterno?: string | null;
    /** Canal comercial (Booking, Airbnb, Site…) — VARCHAR, não ENUM. */
    canalVenda?: string | null;
    idUsuarioCriacao?: number | null;
    status: StatusReservaHospedagem;
    idTransacao?: number | null;
    /** Token opaco para link público /reserva/TOKEN (não previsível). */
    tokenPagamento?: string | null;
    /** Quando preenchido, a reserva AguardandoPagamento pode expirar após esta data. */
    expiraEm?: Date | null;
    linkPagamentoEnviadoEm?: Date | null;
    dataConfirmacao?: Date | null;
    dataHoraCheckinReal?: Date | null;
    idUsuarioCheckin?: number | null;
    dataHoraCheckoutRealizado?: Date | null;
    idUsuarioCheckout?: number | null;
    observacoes?: string | null;
}

interface ReservaHospedagemCreationAttributes
    extends Optional<
        ReservaHospedagemAttributes,
        | 'id'
        | 'idTransacao'
        | 'status'
        | 'dataConfirmacao'
        | 'dataHoraCheckinReal'
        | 'idUsuarioCheckin'
        | 'dataHoraCheckoutRealizado'
        | 'idUsuarioCheckout'
        | 'observacoes'
        | 'valorPago'
        | 'saldoPendente'
        | 'formaPagamentoRecepcao'
        | 'observacaoPagamento'
        | 'comprovantePagamento'
        | 'origemReserva'
        | 'idExterno'
        | 'codigoExterno'
        | 'canalVenda'
    | 'idUsuarioCriacao'
        | 'tokenPagamento'
        | 'expiraEm'
        | 'linkPagamentoEnviadoEm'
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
    public valorPago?: number;
    public saldoPendente?: number | null;
    public formaPagamentoRecepcao?: string | null;
    public observacaoPagamento?: string | null;
    public comprovantePagamento?: string | null;
    public origemReserva?: OrigemReservaHospedagem | string;
    public idExterno?: string | null;
    public codigoExterno?: string | null;
    public canalVenda?: string | null;
    public idUsuarioCriacao?: number | null;
    public status!: StatusReservaHospedagem;
    public idTransacao?: number | null;
    public tokenPagamento?: string | null;
    public expiraEm?: Date | null;
    public linkPagamentoEnviadoEm?: Date | null;
    public dataConfirmacao?: Date | null;
    public dataHoraCheckinReal?: Date | null;
    public idUsuarioCheckin?: number | null;
    public dataHoraCheckoutRealizado?: Date | null;
    public idUsuarioCheckout?: number | null;
    public observacoes?: string | null;

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
            valorPago: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false,
                defaultValue: 0,
            },
            saldoPendente: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true,
            },
            formaPagamentoRecepcao: {
                type: DataTypes.STRING(40),
                allowNull: true,
            },
            observacaoPagamento: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            comprovantePagamento: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },
            origemReserva: {
                // VARCHAR no banco (produção já tem CLIENTE/ATENDENTE).
                // Evita ENUM para não exigir ALTER ao incluir novas origens.
                type: DataTypes.STRING(30),
                allowNull: false,
                defaultValue: 'CLIENTE',
            },
            idExterno: {
                type: DataTypes.STRING(64),
                allowNull: true,
            },
            codigoExterno: {
                type: DataTypes.STRING(64),
                allowNull: true,
            },
            canalVenda: {
                type: DataTypes.STRING(40),
                allowNull: true,
            },
            idUsuarioCriacao: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: Usuario, key: 'id' },
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
            tokenPagamento: {
                type: DataTypes.STRING(64),
                allowNull: true,
                unique: true,
            },
            expiraEm: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            linkPagamentoEnviadoEm: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            dataConfirmacao: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            dataHoraCheckinReal: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            idUsuarioCheckin: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: Usuario, key: 'id' },
            },
            dataHoraCheckoutRealizado: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            idUsuarioCheckout: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: Usuario, key: 'id' },
            },
            observacoes: {
                type: DataTypes.TEXT,
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
        ReservaHospedagem.belongsTo(Usuario, {
            foreignKey: 'idUsuarioCheckin',
            as: 'UsuarioCheckin',
        });
        ReservaHospedagem.belongsTo(Usuario, {
            foreignKey: 'idUsuarioCheckout',
            as: 'UsuarioCheckout',
        });
        ReservaHospedagem.belongsTo(Usuario, {
            foreignKey: 'idUsuarioCriacao',
            as: 'UsuarioCriacao',
        });
    }
}

export const ReservaHospedagemInit = (sequelize: Sequelize) => {
    ReservaHospedagem.initialize(sequelize);
    ReservaHospedagem.associate();
};

export { ReservaHospedagem };
