import { DataTypes, INTEGER, Model, Optional, Sequelize } from 'sequelize';
import { Empresa } from './Empresa';
import { EstruturaTorneio } from './EstruturaTorneio';
import { Usuario } from './Usuario';

// Definição dos atributos da entidade EstruturaTorneio
interface TorneioAttributes {
    id: number;
    descricao: string;
    blindId?: number; // Chave estrangeira para associar com Blind
    empresaId: number;
    estruturaId?: number; // Chave estrangeira para associar com EstruturaTorneio
    dataInicio?: Date;
    status?: 'Criado' | 'parado' | 'em andamento' | 'finalizado';
    blindItemAtual: number;
    tempoRestanteNivel: number;
    usuarioId?: number;
    quantidadeTicketsUtilizados?: number;
}

// Define os atributos necessários para a criação de um novo registro,
// exceto o campo 'id', que é opcional
interface TorneioCreationAttributes extends Optional<TorneioAttributes, 'id'> { }

// Definição da classe EstruturaTorneio que estende a Model do Sequelize
class Torneio extends Model<TorneioAttributes, TorneioCreationAttributes> implements TorneioAttributes {
    public id!: number;
    public descricao!: string;
    public blindId?: number; // Campo para associar com Blind
    public empresaId!: number;
    public estruturaId?: number; // Campo para associar com EstruturaTorneio
    public dataInicio?: Date;
    public status?: 'Criado' | 'parado' | 'em andamento' | 'finalizado';
    public blindItemAtual!: number;
    public tempoRestanteNivel!: number;
    public usuarioId?: number;

    // Inicialização do modelo com Sequelize
    static initialize(sequelize: Sequelize) {
        Torneio.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            descricao: {
                type: DataTypes.STRING,
                allowNull: false
            },
            blindId: {
                type: DataTypes.INTEGER,
                references: {
                    model: 'blind', // Nome da tabela Blind
                    key: 'id'
                },
                allowNull: true,
            },
            empresaId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: Empresa,
                    key: 'id'
                }
            },
            estruturaId: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'estruturaTorneio', // Nome da tabela EstruturaTorneio
                    key: 'id'
                },
            },
            dataInicio: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            status: {
                type: DataTypes.ENUM('Criado', 'parado', 'em andamento', 'finalizado'),
                allowNull: true,
            },
            blindItemAtual: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'torneioBlindItem',
                    key: 'id'
                },
            },
            tempoRestanteNivel: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            usuarioId: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'usuario',
                    key: 'id'
                },
            }
        }, {
            sequelize,
            modelName: "torneio",
            freezeTableName: true,
            timestamps: true,
        });
    }

    public static associate(models: any) {
        // Associação com a tabela Empresa
        Torneio.belongsTo(models.Empresa, { foreignKey: 'empresaId', as: 'empresa' });

        // Associação com a tabela EstruturaTorneio
        Torneio.belongsTo(models.EstruturaTorneio, { foreignKey: 'estruturaId', as: 'estruturaTorneio' });
        Torneio.belongsTo(models.TorneioBlindItem, { foreignKey: 'blindItemAtual', as: 'blindItem' })
        Torneio.belongsTo(models.Usuario, { foreignKey: 'usuarioId', as: 'usuario' })
    }
}

interface TorneioItemAttributes {
    id: number;
    descricao: string;
    fichas: number;
    limiteJogador: boolean;
    qtdePorJogador: number;
    valorInscricao: number;
    taxaAdm: number;
    totalInscricao?: number;
    tipoRake?: '%' | 'R$';
    rake: number;
    torneioId?: number; // Chave estrangeira para associar com Torneio
}

// Define os atributos necessários para a criação de um novo registro,
// exceto o campo 'id', que é opcional
interface TorneioItemCreationAttributes extends Optional<TorneioItemAttributes, 'id'> { }

// Definição da classe EstruturaTorneio que estende a Model do Sequelize
class TorneioItem extends Model<TorneioItemAttributes, TorneioItemCreationAttributes> implements TorneioItemAttributes {
    public id!: number;
    public descricao!: string;
    public fichas!: number;
    public limiteJogador!: boolean;
    public qtdePorJogador!: number;
    public valorInscricao!: number;
    public taxaAdm!: number;
    public totalInscricao?: number;
    public tipoRake?: '%' | 'R$';
    public rake!: number;
    public torneioId?: number; // Campo para associar com Torneio

    // Inicialização do modelo com Sequelize
    static initialize(sequelize: Sequelize) {
        TorneioItem.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            descricao: {
                type: DataTypes.STRING,
                allowNull: false
            },
            fichas: {
                type: DataTypes.DECIMAL,
                allowNull: false,
            },
            limiteJogador: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
            },
            qtdePorJogador: {
                type: INTEGER,
                allowNull: true, // Se necessário, pode definir como obrigatório ou opcional
            },
            valorInscricao: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: false,
            },
            taxaAdm: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: false,
            },
            totalInscricao: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: true,
            },
            tipoRake: {
                type: DataTypes.ENUM('%', 'R$'),
                allowNull: true,
            },
            rake: {
                type: DataTypes.DECIMAL(10, 2),
                allowNull: false,
            },
            torneioId: {
                type: DataTypes.INTEGER,
                references: {
                    model: 'torneio', // Nome da tabela Torneio
                    key: 'id'
                },
                allowNull: false,
            }
        }, {
            sequelize,
            modelName: "torneioItem",
            freezeTableName: true,
            timestamps: true,
        });
    }

    public static associate(models: any) {
        // Associação com a tabela Blind
        TorneioItem.belongsTo(models.Torneio, { foreignKey: 'torneioId', as: 'torneio' });

    }
}

// Definição dos atributos da entidade BlindItem
interface TorneioBlindItemAttributes {
    id: number;
    nivel: number;            // Nível dos blinds (1, 2, 3, etc.)
    smallBlind: number;       // Valor do Small Blind
    bigBlind: number;         // Valor do Big Blind
    ante: number;             // Valor do Ante (se houver)
    duracao: number;          // Duração em minutos de cada nível    
    order?: number;           // Ordem dos itens de blind
    torneioId: number;        // Chave estrangeira para associar com Torneio
}

// Define os atributos necessários para a criação de um novo registro,
// exceto o campo 'id', que é opcional
interface TorneioBlindItemCreationAttributes extends Optional<TorneioBlindItemAttributes, 'id'> { }

// Definição da classe BlindItem que estende a Model do Sequelize
class TorneioBlindItem extends Model<TorneioBlindItemAttributes, TorneioBlindItemCreationAttributes> implements TorneioBlindItemAttributes {
    public id!: number;
    public nivel!: number;
    public smallBlind!: number;
    public bigBlind!: number;
    public ante!: number;
    public duracao!: number;
    public order?: number;
    public torneioId!: number; // Associação com Torneio

    // Inicialização do modelo com Sequelize
    static initialize(sequelize: Sequelize) {
        TorneioBlindItem.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            nivel: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            smallBlind: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            bigBlind: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
            ante: {
                type: DataTypes.INTEGER,
                allowNull: true, // Ante é opcional, depende das regras do torneio
            },
            duracao: {
                type: DataTypes.INTEGER,
                allowNull: false, // Duração dos níveis de blind (em minutos)
            },
            order: {
                type: DataTypes.DECIMAL(5, 2),
                allowNull: true, // Ordem dos itens de blind
            },
            torneioId: {
                type: DataTypes.INTEGER,
                references: {
                    model: 'torneio', // Nome da tabela Torneio
                    key: 'id'
                },
                allowNull: false, // Associação obrigatória
            }
        }, {
            sequelize,
            modelName: "torneioBlindItem",
            freezeTableName: true,
            timestamps: true,
        });
    }

    // Definindo o relacionamento
    public static associate(models: any) {
        // Associação com a tabela Blind
        TorneioBlindItem.belongsTo(models.Torneio, { foreignKey: 'torneioId', as: 'torneio' });

    }
}

// Função para inicializar os modelos
export const TorneioInit = (sequelize: Sequelize) => {
    Torneio.initialize(sequelize);
    TorneioItem.initialize(sequelize);
    TorneioBlindItem.initialize(sequelize);

    // Associar os modelos após a inicialização
    Torneio.associate({ Empresa, EstruturaTorneio, TorneioBlindItem, Usuario });
    TorneioItem.associate({ Torneio });
    TorneioBlindItem.associate({ Torneio });
}

export {
    Torneio,
    TorneioItem,
    TorneioBlindItem,
};
