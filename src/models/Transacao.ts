import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { Evento } from './Evento';
import { Usuario } from './Usuario';
import { Ingresso } from './Ingresso';
import { TipoDesconto } from './CupomPromocional';

enum TipoPagamento {
    Debito = "Débito",
    Credito = "Crédito",
    Pix = "Pix",
    Dinheiro = "Dinheiro"
}

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
    valorRecebido?: number; // Valor líquido após taxas e descontos
    valorTaxaProcessamento?: number; // Valor total das taxas aplicadas
    idTransacaoRecebidoMP?: string; // Opcional, usado para transações de pagamento
    taxaServicoDesconto?: number; // Valor do desconto aplicado na taxa de serviço, se aplicável
    dataPagamento?: Date; // Data do pagamento, se aplicável
    idEvento?: number; // Opcional, usado para transações de eventos
    gatewayPagamento?: string; // Gateway de pagamento utilizado
    tipoPagamento?: TipoPagamento; // Tipo de pagamento utilizado (ex: Cartão de Crédito, Pix, etc.)
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
    public valorRecebido?: number; // Valor líquido após taxas e descontos
    public valorTaxaProcessamento?: number; // Valor total das taxas aplicadas
    public idTransacaoRecebidoMP?: string; // Opcional, usado para transações de pagamento
    public taxaServicoDesconto?: number; // Valor do desconto aplicado na taxa de serviço, se aplicável
    public dataPagamento?: Date; // Data do pagamento, se aplicável
    public idEvento?: number;
    public gatewayPagamento?: string; // Gateway de pagamento utilizado
    public tipoPagamento?: TipoPagamento; // Tipo de pagamento utilizado (ex: Cartão de Crédito, Pix, etc.)

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
            },
            valorRecebido: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true
            },
            valorTaxaProcessamento: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true
            },
            idTransacaoRecebidoMP: {
                type: DataTypes.STRING,
                allowNull: true
            },
            taxaServicoDesconto: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true,
                defaultValue: 0 // Valor padrão
            },
            dataPagamento: {
                type: DataTypes.DATE,
                allowNull: true
            },
            idEvento: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'Evento',
                    key: 'id'
                }
            },
            gatewayPagamento: {
                type: DataTypes.STRING,
                allowNull: true,
                defaultValue: 'MercadoPago' // Valor padrão
            },
            tipoPagamento: {
                type: DataTypes.ENUM(...Object.values(TipoPagamento)),
                allowNull: true,
                // defaultValue: TipoPagamento.Debito // Valor padrão
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
    precoOriginal?: number;
    idCupomPromocionalValidade?: number | null;
    tipoDesconto?: TipoDesconto;
    valorDesconto?: number | null;
    precoDesconto?: number | null;
    preco: number;
    taxaServico: number;
    valorTotal: number;
    taxaServicoDesconto?: number;
    taxaServicoOriginal?: number;
}

interface IngressoTransacaoCreationAttributes extends Optional<IngressoTransacaoAttributes, 'id'> { }

class IngressoTransacao extends Model<IngressoTransacaoAttributes, IngressoTransacaoCreationAttributes> implements IngressoTransacaoAttributes {
    public id!: number;
    public idTransacao!: number;
    public idIngresso!: number;
    public precoOriginal?: number;
    public idCupomPromocionalValidade?: number | null;
    public tipoDesconto?: TipoDesconto;
    public valorDesconto?: number | null;
    public precoDesconto?: number | null;
    public preco!: number;
    public taxaServico!: number;
    public valorTotal!: number;
    public taxaServicoDesconto?: number;
    public taxaServicoOriginal?: number;

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
            precoOriginal: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true
            },
            idCupomPromocionalValidade: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'CupomPromocionalValidade',
                    key: 'id'
                }
            },
            tipoDesconto: {
                type: DataTypes.ENUM('Nenhum', 'Percentual', 'Fixo'),
                allowNull: true,
                defaultValue: 'Nenhum' // Valor padrão
            },
            valorDesconto: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true
            },
            precoDesconto: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true
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
            taxaServicoDesconto: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true,
                defaultValue: 0 // Valor padrão
            },
            taxaServicoOriginal: {
                type: DataTypes.DECIMAL(14, 2),
                allowNull: true,
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
    gatewayPagamento?: string; // Gateway de pagamento utilizado
}

interface TransacaoPagamentoCreationAttributes extends Optional<TransacaoPagamentoAttributes, 'id'> { }

class TransacaoPagamento extends Model<TransacaoPagamentoAttributes, TransacaoPagamentoCreationAttributes> implements TransacaoPagamentoAttributes {
    public id!: number;
    public idTransacao!: number;
    public PagamentoCodigo!: string;
    public gatewayPagamento?: string; // Gateway de pagamento utilizado

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
            },
            gatewayPagamento: {
                type: DataTypes.STRING,
                allowNull: true,
                defaultValue: 'MercadoPago' // Valor padrão
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
    TransacaoPagamento,
    TipoPagamento
};