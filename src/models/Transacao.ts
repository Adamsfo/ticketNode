import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { Evento } from './Evento';
import { Usuario } from './Usuario';
import { Ingresso } from './Ingresso';

// Transacao
interface TransacaoAttributes {
    id: number;
    idUsuario: number;
    dataTransacao: Date;
    preco: number;
    taxaServico: number;
    valorTotal: number;
    status: "Aguardando pagamento" | "Aguardando confirmação" | "Pago" | "Cancelado";
    aceiteCompra: boolean;
}

interface TransacaoCreationAttributes extends Optional<TransacaoAttributes, 'id'> { }

class Transacao extends Model<TransacaoAttributes, TransacaoCreationAttributes> implements TransacaoAttributes {
    public id!: number;
    public idUsuario!: number;
    public dataTransacao!: Date;
    public preco!: number;
    public taxaServico!: number;
    public valorTotal!: number;
    public status!: "Aguardando pagamento" | "Aguardando confirmação" | "Pago" | "Cancelado";
    public aceiteCompra!: boolean;

    static initialize(sequelize: Sequelize) {
        Transacao.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idUsuario: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Usuario',
                    key: 'id'
                }
            },
            dataTransacao: {
                type: DataTypes.DATE,
                allowNull: false
            },
            preco: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false
            },
            taxaServico: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false
            },
            valorTotal: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: false
            },
            status: {
                type: DataTypes.ENUM("Aguardando pagamento", "Aguardando confirmação", "Pago", "Cancelado"),
                allowNull: false
            },
            aceiteCompra: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true
            }
        }, {
            sequelize,
            modelName: "Transacao",
            freezeTableName: true,
        });
    }

    static associate() {
        Transacao.belongsTo(Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario'
        });
        Transacao.hasMany(IngressoTransacao, {
            foreignKey: 'idTransacao',
            as: 'IngressoTransacao'
        });
    }
}

// IngressoTransacao
interface IngressoTransacaoAttributes {
    id: number;
    idTransacao: number;
    idIngresso: number;
    preco: number;
    taxaServico: number;
    valorTotal: number;
}

interface IngressoTransacaoCreationAttributes extends Optional<IngressoTransacaoAttributes, 'id'> { }

class IngressoTransacao extends Model<IngressoTransacaoAttributes, IngressoTransacaoCreationAttributes> implements IngressoTransacaoAttributes {
    public id!: number;
    public idTransacao!: number;
    public idIngresso!: number;
    public preco!: number;
    public taxaServico!: number;
    public valorTotal!: number;

    static initialize(sequelize: Sequelize) {
        IngressoTransacao.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idTransacao: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Transacao',
                    key: 'id'
                }
            },
            idIngresso: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Ingresso',
                    key: 'id'
                }
            },
            preco: {
                type: DataTypes.DECIMAL,
                allowNull: false
            },
            taxaServico: {
                type: DataTypes.DECIMAL,
                allowNull: false
            },
            valorTotal: {
                type: DataTypes.DECIMAL,
                allowNull: false
            }
        }, {
            sequelize,
            modelName: "IngressoTransacao",
            freezeTableName: true,
        });
    }

    static associate() {
        IngressoTransacao.belongsTo(Ingresso, {
            foreignKey: 'idIngresso',
            as: 'Ingresso'
        });
        IngressoTransacao.belongsTo(Transacao, {
            foreignKey: 'idTransacao',
            as: 'Transacao'
        });
    }
}

// HistoricoTransacao
interface HistoricoTransacaoAttributes {
    id: number;
    idTransacao: number;
    idUsuario: number;
    data: Date;
    descricao: string;
}

interface HistoricoTransacaoCreationAttributes extends Optional<HistoricoTransacaoAttributes, 'id'> { }

class HistoricoTransacao extends Model<HistoricoTransacaoAttributes, HistoricoTransacaoCreationAttributes> implements HistoricoTransacaoAttributes {
    public id!: number;
    public idTransacao!: number;
    public idUsuario!: number;
    public data!: Date;
    public descricao!: string;

    static initialize(sequelize: Sequelize) {
        HistoricoTransacao.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idTransacao: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Transacao',
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
            modelName: "HistoricoTransacao",
            freezeTableName: true,
        });
    }

    static associate() {
        HistoricoTransacao.belongsTo(Transacao, {
            foreignKey: 'idTransacao',
            as: 'Transacao'
        });
        HistoricoTransacao.belongsTo(Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario'
        });
    }
}


interface TransacaoPagamentoAttributes {
    id: number;
    idTransacao: number;
    PagamentoCodigo: string;
}

interface TransacaoPagamentoCreationAttributes extends Optional<TransacaoPagamentoAttributes, 'id'> { }

class TransacaoPagamento extends Model<TransacaoPagamentoAttributes, TransacaoPagamentoCreationAttributes> implements TransacaoPagamentoAttributes {
    public id!: number;
    public idTransacao!: number;
    public PagamentoCodigo!: string;

    static initialize(sequelize: Sequelize) {
        TransacaoPagamento.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idTransacao: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Transacao',
                    key: 'id'
                }
            },
            PagamentoCodigo: {
                type: DataTypes.STRING,
                allowNull: false,
            }
        }, {
            sequelize,
            modelName: "TransacaoPagamento",
            freezeTableName: true,
        });
    }

    static associate() {
        TransacaoPagamento.belongsTo(Transacao, {
            foreignKey: 'idTransacao',
            as: 'Transacao'
        });
    }
}

export const TransacaoInit = (sequelize: Sequelize) => {
    Transacao.initialize(sequelize);
    IngressoTransacao.initialize(sequelize);
    HistoricoTransacao.initialize(sequelize);
    TransacaoPagamento.initialize(sequelize);
    Transacao.associate();
    IngressoTransacao.associate();
    HistoricoTransacao.associate();
    TransacaoPagamento.associate();
}

export {
    Transacao,
    IngressoTransacao,
    HistoricoTransacao,
    TransacaoPagamento
};