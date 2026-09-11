import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

import { EventoSuite } from './EventoSuite';

import { ReservaHospedagem } from './ReservaHospedagem';
import { Usuario } from './Usuario';



export enum StatusReservaSuite {
    AguardandoPagamento = 'AguardandoPagamento',
    Confirmada = 'Confirmada',
    Hospedada = 'Hospedada',
    CheckOutRealizado = 'CheckOutRealizado',
    Cancelada = 'Cancelada',
    Expirada = 'Expirada',
}



interface ReservaSuiteAttributes {

    id: number;

    idReservaHospedagem: number;

    idEventoSuite: number;

    adultos: number;

    criancas: number;

    preco: number;

    taxaServico: number;

    valorTotal: number;

    valorOriginal: number | null;

    descontoTipo: 'PERCENTUAL' | 'VALOR' | null;

    descontoValor: number | null;

    valorFinal: number | null;

    status: StatusReservaSuite;

    /** ID da reservation Hospedin vinculada a esta linha (outbound). */
    hospedinReservationId?: string | null;

    dataHoraChegadaReal?: Date | null;

    idUsuarioChegada?: number | null;

    dataHoraCheckinReal?: Date | null;

    idUsuarioCheckin?: number | null;

}



interface ReservaSuiteCreationAttributes

    extends Optional<
        ReservaSuiteAttributes,
        | 'id'
        | 'criancas'
        | 'status'
        | 'valorOriginal'
        | 'descontoTipo'
        | 'descontoValor'
        | 'valorFinal'
        | 'hospedinReservationId'
        | 'dataHoraChegadaReal'
        | 'idUsuarioChegada'
        | 'dataHoraCheckinReal'
        | 'idUsuarioCheckin'
    > {}



class ReservaSuite

    extends Model<ReservaSuiteAttributes, ReservaSuiteCreationAttributes>

    implements ReservaSuiteAttributes {



    public id!: number;

    public idReservaHospedagem!: number;

    public idEventoSuite!: number;

    public adultos!: number;

    public criancas!: number;

    public preco!: number;

    public taxaServico!: number;

    public valorTotal!: number;

    public valorOriginal!: number | null;

    public descontoTipo!: 'PERCENTUAL' | 'VALOR' | null;

    public descontoValor!: number | null;

    public valorFinal!: number | null;

    public status!: StatusReservaSuite;

    public hospedinReservationId?: string | null;

    public dataHoraChegadaReal?: Date | null;

    public idUsuarioChegada?: number | null;

    public dataHoraCheckinReal?: Date | null;

    public idUsuarioCheckin?: number | null;

    static initialize(sequelize: Sequelize) {

        ReservaSuite.init({

            id: {

                type: DataTypes.INTEGER,

                autoIncrement: true,

                primaryKey: true,

            },

            idReservaHospedagem: {

                type: DataTypes.INTEGER,

                allowNull: false,

                references: {

                    model: 'ReservaHospedagem',

                    key: 'id',

                },

            },

            idEventoSuite: {

                type: DataTypes.INTEGER,

                allowNull: false,

                references: {

                    model: 'EventoSuite',

                    key: 'id',

                },

            },

            adultos: {

                type: DataTypes.INTEGER,

                allowNull: false,

                validate: {

                    isInt: true,

                    min: 1,

                },

            },

            criancas: {

                type: DataTypes.INTEGER,

                allowNull: false,

                defaultValue: 0,

                validate: {

                    isInt: true,

                    min: 0,

                },

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

            valorOriginal: {

                type: DataTypes.DECIMAL(14, 2),

                allowNull: true,

            },

            descontoTipo: {

                type: DataTypes.ENUM('PERCENTUAL', 'VALOR'),

                allowNull: true,

            },

            descontoValor: {

                type: DataTypes.DECIMAL(14, 2),

                allowNull: true,

            },

            valorFinal: {

                type: DataTypes.DECIMAL(14, 2),

                allowNull: true,

            },

            status: {

                type: DataTypes.ENUM(...Object.values(StatusReservaSuite)),

                allowNull: false,

                defaultValue: StatusReservaSuite.AguardandoPagamento,

            },

            hospedinReservationId: {

                type: DataTypes.STRING(64),

                allowNull: true,

            },

            dataHoraChegadaReal: {

                type: DataTypes.DATE,

                allowNull: true,

            },

            idUsuarioChegada: {

                type: DataTypes.INTEGER,

                allowNull: true,

                references: { model: Usuario, key: 'id' },

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

        }, {

            sequelize,

            modelName: 'ReservaSuite',

            freezeTableName: true,

        });

    }



    static associate() {

        ReservaSuite.belongsTo(ReservaHospedagem, {

            foreignKey: 'idReservaHospedagem',

            as: 'ReservaHospedagem',

        });

        ReservaSuite.belongsTo(EventoSuite, {

            foreignKey: 'idEventoSuite',

            as: 'EventoSuite',

        });



        ReservaHospedagem.hasMany(ReservaSuite, {

            foreignKey: 'idReservaHospedagem',

            as: 'ReservaSuite',

        });

    }

}



export const ReservaSuiteInit = (sequelize: Sequelize) => {

    ReservaSuite.initialize(sequelize);

    ReservaSuite.associate();

};



export { ReservaSuite };


