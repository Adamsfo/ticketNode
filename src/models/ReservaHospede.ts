import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

export enum TipoReservaHospede {
    Adulto = 'Adulto',
    Crianca = 'Crianca',
}

interface ReservaHospedeAttributes {
    id: number;
    idReservaSuite: number;
    nome: string;
    tipo: TipoReservaHospede;
    dataNascimento?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
}

interface ReservaHospedeCreationAttributes
    extends Optional<ReservaHospedeAttributes, 'id' | 'dataNascimento' | 'createdAt' | 'updatedAt'> {}

class ReservaHospede
    extends Model<ReservaHospedeAttributes, ReservaHospedeCreationAttributes>
    implements ReservaHospedeAttributes {

    public id!: number;
    public idReservaSuite!: number;
    public nome!: string;
    public tipo!: TipoReservaHospede;
    public dataNascimento?: Date | null;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        ReservaHospede.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            idReservaSuite: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'ReservaSuite',
                    key: 'id',
                },
            },
            nome: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            tipo: {
                type: DataTypes.ENUM(...Object.values(TipoReservaHospede)),
                allowNull: false,
            },
            dataNascimento: {
                type: DataTypes.DATEONLY,
                allowNull: true,
            },
        }, {
            sequelize,
            modelName: 'ReservaHospede',
            freezeTableName: true,
            timestamps: true,
        });
    }

    static associate() {
        const { ReservaSuite } = require('./ReservaSuite');

        ReservaHospede.belongsTo(ReservaSuite, {
            foreignKey: 'idReservaSuite',
            as: 'ReservaSuite',
        });
        ReservaSuite.hasMany(ReservaHospede, {
            foreignKey: 'idReservaSuite',
            as: 'ReservaHospede',
        });
    }
}

export const ReservaHospedeInit = (sequelize: Sequelize) => {
    ReservaHospede.initialize(sequelize);
    ReservaHospede.associate();
};

export { ReservaHospede };
