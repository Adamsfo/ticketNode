import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { Evento } from './Evento';
import { Usuario } from './Usuario';
import { EventoIngresso } from './EventoIngresso';
import { Transacao } from './Transacao';
import { TipoIngresso } from './TipoIngresso';

enum TipoVendidoCortesia {
    Vendido = "Vendido",
    Cortesia = "Cortesia"
}

// Ingresso
interface IngressoAttributes {
    id: number;
    idEvento: number;
    idEventoIngresso: number;
    idTipoIngresso: number;
    idUsuario: number;
    atribuirOutroUsuario?: boolean;
    idUsuarioAtribuido?: number;
    dataNascimento?: Date;
    nomeImpresso?: string;
    dataValidade?: Date;
    status: "Reservado" | "Cancelado" | "Confirmado" | "Reembolsado" | "Utilizado";
    qrcode?: string;
    dataUtilizado?: Date;
    tipo?: TipoVendidoCortesia;
}

interface IngressoCreationAttributes extends Optional<IngressoAttributes, 'id'> { }

class Ingresso extends Model<IngressoAttributes, IngressoCreationAttributes> implements IngressoAttributes {
    public id!: number;
    public idEvento!: number;
    public idEventoIngresso!: number;
    public idTipoIngresso!: number;
    public idUsuario!: number;
    public atribuirOutroUsuario?: boolean;
    public idUsuarioAtribuido?: number;
    public dataNascimento?: Date;
    public nomeImpresso?: string;
    public dataValidade?: Date;
    public status!: "Reservado" | "Cancelado" | "Confirmado" | "Reembolsado" | "Utilizado";
    public qrcode?: string;
    public dataUtilizado?: Date;
    public tipo?: TipoVendidoCortesia;

    static initialize(sequelize: Sequelize) {
        Ingresso.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idEvento: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Evento',
                    key: 'id'
                }
            },
            idEventoIngresso: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'EventoIngresso',
                    key: 'id'
                }
            },
            idTipoIngresso: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'TipoIngresso',
                    key: 'id'
                }
            },
            idUsuario: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Usuario',
                    key: 'id'
                }
            },
            atribuirOutroUsuario: {
                type: DataTypes.BOOLEAN,
                allowNull: true
            },
            idUsuarioAtribuido: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'Usuario',
                    key: 'id'
                }
            },
            dataNascimento: {
                type: DataTypes.DATE,
                allowNull: true
            },
            nomeImpresso: {
                type: DataTypes.STRING,
                allowNull: true
            },
            dataValidade: {
                type: DataTypes.DATE,
                allowNull: true
            },
            status: {
                type: DataTypes.ENUM(
                    "Reservado",
                    "Cancelado",
                    "Confirmado",
                    "Reembolsado",
                    "Utilizado"
                ),
                allowNull: false
            },
            qrcode: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                allowNull: false,
                unique: true
            },
            dataUtilizado: {
                type: DataTypes.DATE,
                allowNull: true
            },
            tipo: {
                type: DataTypes.ENUM(
                    TipoVendidoCortesia.Vendido,
                    TipoVendidoCortesia.Cortesia
                ),
                allowNull: true,
                defaultValue: TipoVendidoCortesia.Vendido
            }
        }, {
            sequelize,
            modelName: "Ingresso",
            freezeTableName: true,
        });

    }

    static associate() {
        Ingresso.belongsTo(Evento, {
            foreignKey: 'idEvento',
            as: 'Evento'
        });
        Ingresso.belongsTo(EventoIngresso, {
            foreignKey: 'idEventoIngresso',
            as: 'EventoIngresso'
        });
        Ingresso.belongsTo(TipoIngresso, {
            foreignKey: 'idTipoIngresso',
            as: 'TipoIngresso'
        });
        Ingresso.belongsTo(Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario'
        });
    }
}

// HistoricoIngresso
interface HistoricoIngressoAttributes {
    id: number;
    idIngresso: number;
    idUsuario: number;
    data: Date;
    descricao: string;
}

interface HistoricoIngressoCreationAttributes extends Optional<HistoricoIngressoAttributes, 'id'> { }

class HistoricoIngresso extends Model<HistoricoIngressoAttributes, HistoricoIngressoCreationAttributes> implements HistoricoIngressoAttributes {
    public id!: number;
    public idIngresso!: number;
    public idUsuario!: number;
    public data!: Date;
    public descricao!: string;

    static initialize(sequelize: Sequelize) {
        HistoricoIngresso.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idIngresso: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Ingresso',
                    key: 'id'
                }
            },
            idUsuario: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Usuario',
                    key: 'id'
                }
            },
            data: {
                type: DataTypes.DATE,
                allowNull: false
            },
            descricao: {
                type: DataTypes.STRING,
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
        HistoricoIngresso.belongsTo(Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario'
        });
    }
}


export const IngressoInit = (sequelize: Sequelize) => {
    Ingresso.initialize(sequelize);
    HistoricoIngresso.initialize(sequelize);
    Ingresso.associate();
    HistoricoIngresso.associate();
}

export {
    Ingresso,
    HistoricoIngresso
};