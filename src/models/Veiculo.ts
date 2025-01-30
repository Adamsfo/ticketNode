import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { Empresa } from './Empresa';

interface SeguimentoAttributes {
    id: number;
    seguimento: string;
}

interface SegmentoCreationAttributes extends Optional<SeguimentoAttributes, 'id'> { }

class Seguimento extends Model<SeguimentoAttributes, SegmentoCreationAttributes> implements SeguimentoAttributes {
    public id!: number;
    public seguimento!: string;

    static initialize(sequelize: Sequelize) {
        Seguimento.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                seguimento: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
            }, {
            sequelize,
            modelName: "Seguimento",
            freezeTableName: true
        }
        );
    }
}

interface MarcaAttributes {
    id: number;
    marca: string;
}

interface MarcaCreationAttributes extends Optional<MarcaAttributes, 'id'> { }

class Marca extends Model<MarcaAttributes, MarcaCreationAttributes> implements MarcaAttributes {
    public id!: number;
    public marca!: string;

    static initialize(sequelize: Sequelize) {
        Marca.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                marca: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
            }, {
            sequelize,
            modelName: "Marca",
            freezeTableName: true
        }
        );
    }
}

// Define a interface para os atributos do modelo
interface VeiculoAttributes {
    id: number;
    veiculo: string;
    marcaId: number;
    segmentoId: number;
    inativo: boolean;
}

// Define uma interface para atributos opcionais ao criar um novo registro
interface VeiculoCreationAttributes extends Optional<VeiculoAttributes, 'id'> { }

// Define o modelo
class Veiculo extends Model<VeiculoAttributes, VeiculoCreationAttributes> implements VeiculoAttributes {
    public id!: number;
    public veiculo!: string;
    public marcaId!: number;
    public segmentoId!: number;
    public inativo!: boolean;

    // timestamps!
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        Veiculo.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                veiculo: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                marcaId: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: Marca, // Nome da tabela de marcas
                        key: 'id',
                    },
                },
                segmentoId: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: Seguimento, // Nome da tabela de segmentos
                        key: 'id',
                    },
                },
                inativo: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: false,
                },
            }, {
            sequelize,
            modelName: "Veiculo",
            freezeTableName: true
        }
        );
    }

    // Define as associações entre os modelos
    static associate(models: any) {
        // Associação entre Veiculo e Marca
        Veiculo.belongsTo(models.Marca, { foreignKey: 'marcaId' });

        // Associação entre Veiculo e Seguimento
        Veiculo.belongsTo(models.Seguimento, { foreignKey: 'segmentoId' });        
    }      
}

interface MotorAttributes {
    id: number;
    motor: string;
    cilindradas: string;
}

interface MotorCreationAttributes extends Optional<MotorAttributes, 'id'> { }

class Motor extends Model<MotorAttributes, MotorCreationAttributes> implements MotorAttributes {
    public id!: number;
    public motor!: string;
    public cilindradas!: string;

    static initialize(sequelize: Sequelize) {
        Motor.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                motor: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                cilindradas: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
            }, {
            sequelize,
            modelName: "Motor",
            freezeTableName: true
        }
        );
    }
}

interface CombustivelAttributes {
    id: number;
    combustivel: string;
}

interface CombustivelCreationAttributes extends Optional<CombustivelAttributes, 'id'> { }

class Combustivel extends Model<CombustivelAttributes, CombustivelCreationAttributes> implements CombustivelAttributes {
    public id!: number;
    public combustivel!: string;

    static initialize(sequelize: Sequelize) {
        Combustivel.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                combustivel: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
            }, {
            sequelize,
            modelName: "Combustivel",
            freezeTableName: true
        }
        );
    }
}

interface OrigemAttributes {
    id: number;
    origem: string;
}

interface OrigemCreationAttributes extends Optional<OrigemAttributes, 'id'> { }

class Origem extends Model<OrigemAttributes, OrigemCreationAttributes> implements OrigemAttributes {
    public id!: number;
    public origem!: string;

    static initialize(sequelize: Sequelize) {
        Origem.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                origem: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
            }, {
            sequelize,
            modelName: "Origem",
            freezeTableName: true
        }
        );
    }
}

interface ModeloAttributes {
    id: number;
    modelo: string;
    veiculoId: number;
    tipoModelo: 'Novo' | 'Usado';
    motorId: number;
    versaoSeries: string;
    linha: string;
    anoModelo: string;
    combustivelId: number;
    renavan: string;
    origemId: number;
    transmissao: 'Manual' | 'Automático';
    nPortas: number;
    precoCustom: number;
    precoVenda: number;
    custoFrete: number;
    inativo: boolean;
}

interface ModeloCreationAttributes extends Optional<ModeloAttributes, 'id'> { }

class Modelo extends Model<ModeloAttributes, ModeloCreationAttributes> implements ModeloAttributes {
    public id!: number;
    public modelo!: string;
    public veiculoId!: number;
    public tipoModelo!: 'Novo' | 'Usado';
    public motorId!: number;
    public versaoSeries!: string;
    public linha!: string;
    public anoModelo!: string;
    public combustivelId!: number;
    public renavan!: string;
    public origemId!: number;
    public transmissao!: 'Manual' | 'Automático';
    public nPortas!: number;
    public precoCustom!: number;
    public precoVenda!: number;
    public custoFrete!: number;
    public inativo!: boolean;

    static initialize(sequelize: Sequelize) {
        Modelo.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                modelo: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                veiculoId: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: Veiculo, 
                        key: 'id',
                    },
                },
                tipoModelo: {
                    type: DataTypes.ENUM('Novo', 'Usado'),
                    allowNull: false,
                },
                motorId: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: Motor, // Nome da tabela de motores
                        key: 'id',
                    },
                },
                versaoSeries: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                linha: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                anoModelo: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                combustivelId: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: Combustivel, // Nome da tabela de combustíveis
                        key: 'id',
                    },
                },
                renavan: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                origemId: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: Origem, // Nome da tabela de origens
                        key: 'id',
                    },
                },
                transmissao: {
                    type: DataTypes.ENUM('Manual', 'Automático'),
                    allowNull: false,
                },
                nPortas: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                },
                precoCustom: {
                    type: DataTypes.FLOAT,
                    allowNull: false,
                },
                precoVenda: {
                    type: DataTypes.FLOAT,
                    allowNull: false,
                },
                custoFrete: {
                    type: DataTypes.FLOAT,
                    allowNull: false,
                },
                inativo: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: false,
                },
            }, {
            sequelize,
            modelName: "Modelo",
            freezeTableName: true
        }
        );
    }

    // Define as associações entre os modelos
    static associate(models: any) {
        // Associação entre Modelo e Motor
        Modelo.belongsTo(models.Motor, { foreignKey: 'motorId' });        

        // Associação entre Modelo e Combustivel
        Modelo.belongsTo(models.Combustivel, { foreignKey: 'combustivelId' });        

        // Associação entre Modelo e Origem
        Modelo.belongsTo(models.Origem, { foreignKey: 'origemId' });        

        // Associação entre Modelo e Veiculo
        Modelo.belongsTo(models.Veiculo, { foreignKey: 'veiculoId' });        
    }
}


interface PedidoFabricaAttributes {
    id: number;
    numeroNota: string;
    modeloId: number;
    serieChassi: string;
    status: 'JORADO' | 'FABRICA';
    destino: string;
    empresaId: number;
    observacao: string;
    dataExpFabrica: Date;
    dataExpJorado: Date;
    valor: number;
}

interface PedidoFabricaCreationAttributes extends Optional<PedidoFabricaAttributes, 'id'> { }

class PedidoFabrica extends Model<PedidoFabricaAttributes, PedidoFabricaCreationAttributes> implements PedidoFabricaAttributes {
    public id!: number;
    public numeroNota!: string;
    public modeloId!: number;
    public serieChassi!: string;
    public status!: 'JORADO' | 'FABRICA';
    public destino!: string;
    public empresaId!: number;
    public observacao!: string;
    public dataExpFabrica!: Date;
    public dataExpJorado!: Date;
    public valor!: number;

    static initialize(sequelize: Sequelize) {
        PedidoFabrica.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                numeroNota: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                modeloId: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: Modelo,
                        key: 'id'
                    }
                },
                serieChassi: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                status: {
                    type: DataTypes.ENUM('JORADO', 'FABRICA'),
                    allowNull: false,
                },
                destino: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                empresaId: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: {
                        model: Empresa,
                        key: 'id'
                    }
                },
                observacao: {
                    type: DataTypes.STRING,
                    allowNull: false,
                },
                dataExpFabrica: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                dataExpJorado: {
                    type: DataTypes.DATE,
                    allowNull: false,
                },
                valor: {
                    type: DataTypes.FLOAT,
                    allowNull: false,
                },
            }, {
            sequelize,
            modelName: "PedidoFabrica",
            freezeTableName: true
        }
        );
    }

    // Define as associações entre os modelos
    static associate(models: any) {        
        // Associação entre PedidoFabrica e Modelo
        PedidoFabrica.belongsTo(models.Modelo, { foreignKey: 'modeloId' });

        // Associação entre PedidoFabrica e Empresa
        PedidoFabrica.belongsTo(models.Empresa, { foreignKey: 'empresaId' });
    }
}


// Função para inicializar todos os modelos
export const VeiculoInit = (sequelize: Sequelize) => {
    Seguimento.initialize(sequelize);
    Marca.initialize(sequelize)
    Veiculo.initialize(sequelize);
    Veiculo.associate({ Marca, Seguimento });
    Motor.initialize(sequelize);
    Combustivel.initialize(sequelize);
    Origem.initialize(sequelize);
    Modelo.initialize(sequelize);    
    Modelo.associate({ Motor, Combustivel, Origem, Veiculo });
    PedidoFabrica.initialize(sequelize);
    PedidoFabrica.associate({ Modelo, Empresa })
}

export {
    Seguimento,
    Marca,
    Veiculo,
    Motor,
    Combustivel,
    Origem,
    Modelo,
    PedidoFabrica
};
