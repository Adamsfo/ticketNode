import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface ReservaHospedeDocumentoAttributes {
    id: number;
    idReservaHospede: number;
    provider?: string | null;
    tipo: string;
    numero: string;
    paisEmissao?: string | null;
    observacao?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
}

type Creation = Optional<
    ReservaHospedeDocumentoAttributes,
    'id' | 'provider' | 'paisEmissao' | 'observacao' | 'createdAt' | 'updatedAt'
>;

class ReservaHospedeDocumento
    extends Model<ReservaHospedeDocumentoAttributes, Creation>
    implements ReservaHospedeDocumentoAttributes
{
    public id!: number;
    public idReservaHospede!: number;
    public provider?: string | null;
    public tipo!: string;
    public numero!: string;
    public paisEmissao?: string | null;
    public observacao?: string | null;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        ReservaHospedeDocumento.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                idReservaHospede: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                },
                provider: {
                    type: DataTypes.STRING(40),
                    allowNull: true,
                },
                tipo: {
                    type: DataTypes.STRING(40),
                    allowNull: false,
                },
                numero: {
                    type: DataTypes.STRING(80),
                    allowNull: false,
                },
                paisEmissao: {
                    type: DataTypes.STRING(8),
                    allowNull: true,
                },
                observacao: {
                    type: DataTypes.STRING(255),
                    allowNull: true,
                },
            },
            {
                sequelize,
                modelName: 'ReservaHospedeDocumento',
                tableName: 'reserva_hospede_documento',
                freezeTableName: true,
                timestamps: true,
            }
        );
    }

    static associate() {
        const { ReservaHospede } = require('./ReservaHospede');
        ReservaHospedeDocumento.belongsTo(ReservaHospede, {
            foreignKey: 'idReservaHospede',
            as: 'ReservaHospede',
        });
        ReservaHospede.hasMany(ReservaHospedeDocumento, {
            foreignKey: 'idReservaHospede',
            as: 'Documentos',
        });
    }
}

export const ReservaHospedeDocumentoInit = (sequelize: Sequelize) => {
    ReservaHospedeDocumento.initialize(sequelize);
    ReservaHospedeDocumento.associate();
};

export { ReservaHospedeDocumento };
