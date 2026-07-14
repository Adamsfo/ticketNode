"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReservaHospede = exports.ReservaHospedeInit = exports.TipoReservaHospede = void 0;
const sequelize_1 = require("sequelize");
var TipoReservaHospede;
(function (TipoReservaHospede) {
    TipoReservaHospede["Adulto"] = "Adulto";
    TipoReservaHospede["Crianca"] = "Crianca";
})(TipoReservaHospede || (exports.TipoReservaHospede = TipoReservaHospede = {}));
class ReservaHospede extends sequelize_1.Model {
    static initialize(sequelize) {
        ReservaHospede.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            idReservaSuite: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'ReservaSuite',
                    key: 'id',
                },
            },
            nome: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false,
            },
            tipo: {
                type: sequelize_1.DataTypes.ENUM(...Object.values(TipoReservaHospede)),
                allowNull: false,
            },
            dataNascimento: {
                type: sequelize_1.DataTypes.DATEONLY,
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
exports.ReservaHospede = ReservaHospede;
const ReservaHospedeInit = (sequelize) => {
    ReservaHospede.initialize(sequelize);
    ReservaHospede.associate();
};
exports.ReservaHospedeInit = ReservaHospedeInit;
