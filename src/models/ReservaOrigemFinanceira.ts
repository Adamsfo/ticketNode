import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface ReservaOrigemFinanceiraAttributes {
    id: number;
    idReservaHospedagem: number;
    provider: string;
    moeda?: string | null;
    totalCents?: number | null;
    receivedCents?: number | null;
    toReceiveCents?: number | null;
    dailyCents?: number | null;
    totalDailyCents?: number | null;
    discountCents?: number | null;
    productCents?: number | null;
    serviceCents?: number | null;
    itemsCount?: number | null;
    paymentFromOta?: boolean | null;
    statusPagamento?: string | null;
    formaPagamento?: string | null;
    origemPagamento?: string | null;
    responsavelPagamento?: string | null;
    rawJson?: object | null;
    payloadHash?: string | null;
    syncedAt: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

type Creation = Optional<
    ReservaOrigemFinanceiraAttributes,
    | 'id'
    | 'moeda'
    | 'totalCents'
    | 'receivedCents'
    | 'toReceiveCents'
    | 'dailyCents'
    | 'totalDailyCents'
    | 'discountCents'
    | 'productCents'
    | 'serviceCents'
    | 'itemsCount'
    | 'paymentFromOta'
    | 'statusPagamento'
    | 'formaPagamento'
    | 'origemPagamento'
    | 'responsavelPagamento'
    | 'rawJson'
    | 'payloadHash'
    | 'createdAt'
    | 'updatedAt'
>;

class ReservaOrigemFinanceira
    extends Model<ReservaOrigemFinanceiraAttributes, Creation>
    implements ReservaOrigemFinanceiraAttributes
{
    public id!: number;
    public idReservaHospedagem!: number;
    public provider!: string;
    public moeda?: string | null;
    public totalCents?: number | null;
    public receivedCents?: number | null;
    public toReceiveCents?: number | null;
    public dailyCents?: number | null;
    public totalDailyCents?: number | null;
    public discountCents?: number | null;
    public productCents?: number | null;
    public serviceCents?: number | null;
    public itemsCount?: number | null;
    public paymentFromOta?: boolean | null;
    public statusPagamento?: string | null;
    public formaPagamento?: string | null;
    public origemPagamento?: string | null;
    public responsavelPagamento?: string | null;
    public rawJson?: object | null;
    public payloadHash?: string | null;
    public syncedAt!: Date;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        ReservaOrigemFinanceira.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                idReservaHospedagem: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                },
                provider: {
                    type: DataTypes.STRING(40),
                    allowNull: false,
                },
                moeda: { type: DataTypes.CHAR(3), allowNull: true },
                totalCents: { type: DataTypes.INTEGER, allowNull: true },
                receivedCents: { type: DataTypes.INTEGER, allowNull: true },
                toReceiveCents: { type: DataTypes.INTEGER, allowNull: true },
                dailyCents: { type: DataTypes.INTEGER, allowNull: true },
                totalDailyCents: { type: DataTypes.INTEGER, allowNull: true },
                discountCents: { type: DataTypes.INTEGER, allowNull: true },
                productCents: { type: DataTypes.INTEGER, allowNull: true },
                serviceCents: { type: DataTypes.INTEGER, allowNull: true },
                itemsCount: { type: DataTypes.INTEGER, allowNull: true },
                paymentFromOta: { type: DataTypes.BOOLEAN, allowNull: true },
                statusPagamento: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                formaPagamento: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                origemPagamento: {
                    type: DataTypes.STRING(40),
                    allowNull: true,
                },
                responsavelPagamento: {
                    type: DataTypes.STRING(64),
                    allowNull: true,
                },
                rawJson: { type: DataTypes.JSON, allowNull: true },
                payloadHash: { type: DataTypes.STRING(64), allowNull: true },
                syncedAt: { type: DataTypes.DATE, allowNull: false },
            },
            {
                sequelize,
                modelName: 'ReservaOrigemFinanceira',
                tableName: 'reserva_origem_financeira',
                freezeTableName: true,
                timestamps: true,
            }
        );
    }

    static associate() {
        const { ReservaHospedagem } = require('./ReservaHospedagem');
        ReservaOrigemFinanceira.belongsTo(ReservaHospedagem, {
            foreignKey: 'idReservaHospedagem',
            as: 'ReservaHospedagem',
        });
        ReservaHospedagem.hasOne(ReservaOrigemFinanceira, {
            foreignKey: 'idReservaHospedagem',
            as: 'OrigemFinanceira',
        });
    }
}

export const ReservaOrigemFinanceiraInit = (sequelize: Sequelize) => {
    ReservaOrigemFinanceira.initialize(sequelize);
    ReservaOrigemFinanceira.associate();
};

export { ReservaOrigemFinanceira };
