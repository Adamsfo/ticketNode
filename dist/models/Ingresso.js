"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TipoVendidoCortesia = exports.HistoricoIngresso = exports.Ingresso = exports.IngressoInit = void 0;
const sequelize_1 = require("sequelize");
const Evento_1 = require("./Evento");
const Usuario_1 = require("./Usuario");
const EventoIngresso_1 = require("./EventoIngresso");
const TipoIngresso_1 = require("./TipoIngresso");
var TipoVendidoCortesia;
(function (TipoVendidoCortesia) {
    TipoVendidoCortesia["Vendido"] = "Vendido";
    TipoVendidoCortesia["Cortesia"] = "Cortesia";
})(TipoVendidoCortesia || (exports.TipoVendidoCortesia = TipoVendidoCortesia = {}));
class Ingresso extends sequelize_1.Model {
    static initialize(sequelize) {
        Ingresso.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idEvento: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Evento',
                    key: 'id'
                }
            },
            idEventoIngresso: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'EventoIngresso',
                    key: 'id'
                }
            },
            idTipoIngresso: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'TipoIngresso',
                    key: 'id'
                }
            },
            idUsuario: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Usuario',
                    key: 'id'
                }
            },
            atribuirOutroUsuario: {
                type: sequelize_1.DataTypes.BOOLEAN,
                allowNull: true
            },
            idUsuarioAtribuido: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'Usuario',
                    key: 'id'
                }
            },
            dataNascimento: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: true
            },
            nomeImpresso: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            },
            dataValidade: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: true
            },
            status: {
                type: sequelize_1.DataTypes.ENUM("Reservado", "Cancelado", "Confirmado", "Reembolsado", "Utilizado"),
                allowNull: false
            },
            qrcode: {
                type: sequelize_1.DataTypes.UUID,
                defaultValue: sequelize_1.DataTypes.UUIDV4,
                allowNull: false,
                unique: true
            },
            dataUtilizado: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: true
            },
            tipo: {
                type: sequelize_1.DataTypes.ENUM(TipoVendidoCortesia.Vendido, TipoVendidoCortesia.Cortesia),
                allowNull: true,
                defaultValue: TipoVendidoCortesia.Vendido
            },
            idUsuarioCriouIngresso: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'Usuario',
                    key: 'id'
                }
            }
        }, {
            sequelize,
            modelName: "Ingresso",
            freezeTableName: true,
        });
    }
    static associate() {
        Ingresso.belongsTo(Evento_1.Evento, {
            foreignKey: 'idEvento',
            as: 'Evento'
        });
        Ingresso.belongsTo(EventoIngresso_1.EventoIngresso, {
            foreignKey: 'idEventoIngresso',
            as: 'EventoIngresso'
        });
        Ingresso.belongsTo(TipoIngresso_1.TipoIngresso, {
            foreignKey: 'idTipoIngresso',
            as: 'TipoIngresso'
        });
        Ingresso.belongsTo(Usuario_1.Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario'
        });
        Ingresso.belongsTo(Usuario_1.Usuario, {
            foreignKey: 'idUsuarioCriouIngresso',
            as: 'UsuarioCriouIngresso'
        });
    }
}
exports.Ingresso = Ingresso;
class HistoricoIngresso extends sequelize_1.Model {
    static initialize(sequelize) {
        HistoricoIngresso.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idIngresso: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Ingresso',
                    key: 'id'
                }
            },
            idUsuario: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Usuario',
                    key: 'id'
                }
            },
            data: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: false
            },
            descricao: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false
            }
        }, {
            sequelize,
            modelName: "HistoricoIngresso",
            freezeTableName: true,
        });
    }
    static associate() {
        HistoricoIngresso.belongsTo(Ingresso, {
            foreignKey: 'idIngresso',
            as: 'Ingresso'
        });
        HistoricoIngresso.belongsTo(Usuario_1.Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario'
        });
    }
}
exports.HistoricoIngresso = HistoricoIngresso;
const IngressoInit = (sequelize) => {
    Ingresso.initialize(sequelize);
    HistoricoIngresso.initialize(sequelize);
    Ingresso.associate();
    HistoricoIngresso.associate();
};
exports.IngressoInit = IngressoInit;
