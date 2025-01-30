import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { Torneio, TorneioItem } from './Torneio';
import { ClienteFornecedor } from './ClienteFornecedor';
import { Usuario } from './Usuario';
import { Empresa } from './Empresa';
import { Pagamento } from './Pagamento';

interface TicketAttributes {
    id: number;
    uid: string;
    torneioId: number;
    torneioItemId: number;
    clienteId: number;
    clienteIdPagou: number;
    valorInscricao: number;
    taxaAdm: number;
    rake: number;
    fichas: number;
    usuarioId: number;
    empresaId: number;
    pagamentoId: number;
    metodoPagamento: 'Pagamento' | 'Crédito na Conta'
    status: 'DISPONÍVEL' | 'PENDENTE' | 'CANCELADO' | 'UTILIZADO';
}

interface TicketCreationAttributes extends Optional<TicketAttributes, 'id'> { }

class Ticket extends Model<TicketAttributes, TicketCreationAttributes> implements TicketAttributes {
    public id!: number;
    public uid!: string;
    public torneioId!: number;
    public torneioItemId!: number;
    public clienteId!: number;
    public clienteIdPagou!: number;
    public valorInscricao!: number;
    public taxaAdm!: number;
    public rake!: number;
    public fichas!: number;
    public usuarioId!: number;
    public empresaId!: number;
    public pagamentoId!: number;
    public metodoPagamento!: 'Pagamento' | 'Crédito na Conta'
    public status!: 'DISPONÍVEL' | 'PENDENTE' | 'CANCELADO' | 'UTILIZADO';

    static initialize(sequelize: Sequelize) {
        Ticket.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            uid: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4, // Gera um UUID único automaticamente
                allowNull: false,
                unique: true
            },
            torneioId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'torneio',
                    key: 'id'
                },
            },
            torneioItemId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'TorneioItem',
                    key: 'id'
                },
            },
            clienteId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'ClienteFornecedor',
                    key: 'id'
                },
            },
            clienteIdPagou: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'ClienteFornecedor',
                    key: 'id'
                },
            },
            valorInscricao: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: false,
            },
            taxaAdm: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: false,
            },
            rake: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: false,
            },
            fichas: {
                type: DataTypes.DECIMAL,
                allowNull: false,
            },
            usuarioId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Usuario',
                    key: 'id'
                },
            },
            empresaId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Empresa',
                    key: 'id'
                },
            },
            pagamentoId: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'Pagamento',
                    key: 'id'
                },
            },
            metodoPagamento: {
                type: DataTypes.ENUM('Pagamento', 'Crédito na Conta'),
                allowNull: false,
            },
            status: {
                type: DataTypes.ENUM('DISPONÍVEL', 'PENDENTE', 'CANCELADO', 'UTILIZADO'),
                allowNull: false,
            }
        }, {
            sequelize,
            modelName: "Ticket",
            freezeTableName: true,
            timestamps: true,
        });
    }

    static associate() {
        Ticket.belongsTo(Torneio, {
            foreignKey: 'torneioId',
            as: 'torneio'
        });
        Ticket.belongsTo(ClienteFornecedor, {
            foreignKey: 'clienteId',
            as: 'ClienteFornecedor'
        });
        Ticket.belongsTo(Usuario, {
            foreignKey: 'usuarioId',
            as: 'usuario'
        });
        Ticket.belongsTo(Empresa, {
            foreignKey: 'empresaId',
            as: 'empresa'
        });
        Ticket.belongsTo(TorneioItem, {
            foreignKey: 'torneioItemId',
            as: 'torneioItem'
        });
        Ticket.belongsTo(Pagamento, {
            foreignKey: 'pagamentoId',
            as: 'pagamento'
        });
        Torneio.hasMany(Ticket, {
            foreignKey: 'torneioId',
            as: 'tickets'
        });
    }
}

interface TicketHistoricoAttributes {
    id: number;
    ticketId: number;
    descricao: string;
    data: Date;
    usuarioId: number;
    status: 'DISPONÍVEL' | 'PENDENTE' | 'CANCELADO' | 'UTILIZADO';
}

interface TicketHistoricoCreationAttributes extends Optional<TicketHistoricoAttributes, 'id'> { }

class TicketHistorico extends Model<TicketHistoricoAttributes, TicketHistoricoCreationAttributes> implements TicketHistoricoAttributes {
    public id!: number;
    public ticketId!: number;
    public descricao!: string;
    public data!: Date;
    public usuarioId!: number;
    public status!: 'DISPONÍVEL' | 'PENDENTE' | 'CANCELADO' | 'UTILIZADO';

    static initialize(sequelize: Sequelize) {
        TicketHistorico.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            ticketId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Ticket',
                    key: 'id'
                },
            },
            descricao: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            data: {
                type: DataTypes.DATE,
                allowNull: false,
            },
            usuarioId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Usuario',
                    key: 'id'
                },
            },
            status: {
                type: DataTypes.ENUM('DISPONÍVEL', 'PENDENTE', 'CANCELADO', 'UTILIZADO'),
                allowNull: false,
            }
        }, {
            sequelize,
            modelName: "TicketHistorico",
            freezeTableName: true,
            timestamps: true,
        });
    }

    static associate() {
        TicketHistorico.belongsTo(Ticket, {
            foreignKey: 'ticketId',
            as: 'ticket'
        });
        TicketHistorico.belongsTo(Usuario, {
            foreignKey: 'usuarioId',
            as: 'usuario'
        });
    }
}

export const TicketInit = (sequelize: Sequelize) => {
    Ticket.initialize(sequelize);
    TicketHistorico.initialize(sequelize)

    Ticket.associate();
    TicketHistorico.associate()
}

export {
    Ticket,
    TicketHistorico
};
