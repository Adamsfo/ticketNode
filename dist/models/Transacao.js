"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransacaoPagamento = exports.HistoricoTransacao = exports.IngressoTransacao = exports.Transacao = exports.TransacaoInit = void 0;
const sequelize_1 = require("sequelize");
const Usuario_1 = require("./Usuario");
const Ingresso_1 = require("./Ingresso");
class Transacao extends sequelize_1.Model {
    static initialize(sequelize) {
        Transacao.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idUsuario: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Usuario',
                    key: 'id'
                }
            },
            dataTransacao: {
                type: sequelize_1.DataTypes.DATE,
                allowNull: false
            },
            preco: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: false
            },
            taxaServico: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: false
            },
            valorTotal: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: false
            },
            status: {
                type: sequelize_1.DataTypes.ENUM("Aguardando pagamento", "Aguardando confirmação", "Pago", "Cancelado"),
                allowNull: false
            },
            aceiteCompra: {
                type: sequelize_1.DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true
            },
            valorRecebido: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: true
            },
            valorTaxaProcessamento: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: true
            },
            idTransacaoRecebidoMP: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: true
            }
        }, {
            sequelize,
            modelName: "Transacao",
            freezeTableName: true,
        });
    }
    static associate() {
        Transacao.belongsTo(Usuario_1.Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario'
        });
        Transacao.hasMany(IngressoTransacao, {
            foreignKey: 'idTransacao',
            as: 'IngressoTransacao'
        });
    }
}
exports.Transacao = Transacao;
class IngressoTransacao extends sequelize_1.Model {
    static initialize(sequelize) {
        IngressoTransacao.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idTransacao: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Transacao',
                    key: 'id'
                }
            },
            idIngresso: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Ingresso',
                    key: 'id'
                }
            },
            precoOriginal: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: true
            },
            idCupomPromocionalValidade: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'CupomPromocionalValidade',
                    key: 'id'
                }
            },
            tipoDesconto: {
                type: sequelize_1.DataTypes.ENUM('Nenhum', 'Percentual', 'Fixo'),
                allowNull: true,
                defaultValue: 'Nenhum' // Valor padrão
            },
            valorDesconto: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: true
            },
            precoDesconto: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: true
            },
            preco: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: false
            },
            taxaServico: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: false
            },
            valorTotal: {
                type: sequelize_1.DataTypes.DECIMAL(14, 2),
                allowNull: false
            }
        }, {
            sequelize,
            modelName: "IngressoTransacao",
            freezeTableName: true,
        });
    }
    static associate() {
        IngressoTransacao.belongsTo(Ingresso_1.Ingresso, {
            foreignKey: 'idIngresso',
            as: 'Ingresso'
        });
        IngressoTransacao.belongsTo(Transacao, {
            foreignKey: 'idTransacao',
            as: 'Transacao'
        });
    }
}
exports.IngressoTransacao = IngressoTransacao;
class HistoricoTransacao extends sequelize_1.Model {
    static initialize(sequelize) {
        HistoricoTransacao.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idTransacao: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Transacao',
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
            modelName: "HistoricoTransacao",
            freezeTableName: true,
        });
    }
    static associate() {
        HistoricoTransacao.belongsTo(Transacao, {
            foreignKey: 'idTransacao',
            as: 'Transacao'
        });
        HistoricoTransacao.belongsTo(Usuario_1.Usuario, {
            foreignKey: 'idUsuario',
            as: 'Usuario'
        });
    }
}
exports.HistoricoTransacao = HistoricoTransacao;
class TransacaoPagamento extends sequelize_1.Model {
    static initialize(sequelize) {
        TransacaoPagamento.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idTransacao: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Transacao',
                    key: 'id'
                }
            },
            PagamentoCodigo: {
                type: sequelize_1.DataTypes.STRING,
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
exports.TransacaoPagamento = TransacaoPagamento;
const TransacaoInit = (sequelize) => {
    Transacao.initialize(sequelize);
    IngressoTransacao.initialize(sequelize);
    HistoricoTransacao.initialize(sequelize);
    TransacaoPagamento.initialize(sequelize);
    Transacao.associate();
    IngressoTransacao.associate();
    HistoricoTransacao.associate();
    TransacaoPagamento.associate();
};
exports.TransacaoInit = TransacaoInit;
