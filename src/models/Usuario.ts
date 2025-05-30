import { Model, DataTypes, Optional, Sequelize } from 'sequelize';
import { Empresa } from './Empresa';
const bcrypt = require('bcrypt');

// Definindo interfaces para atributos e criação de modelos
interface FuncaoSistemaAttributes {
    id: number;
    funcaoSistema: string;
}

interface FuncaoSistemaCreationAttributes extends Optional<FuncaoSistemaAttributes, 'id'> { }

class FuncaoSistema extends Model<FuncaoSistemaAttributes, FuncaoSistemaCreationAttributes> implements FuncaoSistemaAttributes {
    public id!: number;
    public funcaoSistema!: string;

    static initialize(sequelize: Sequelize) {
        FuncaoSistema.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            funcaoSistema: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true
            }
        }, {
            sequelize,
            modelName: "FuncaoSistema",
            freezeTableName: true
        });
    }
}

interface FuncaoUsuarioAttributes {
    id: number;
    funcaoUsuario: string;
}

interface FuncaoUsuarioCreationAttributes extends Optional<FuncaoUsuarioAttributes, 'id'> { }

class FuncaoUsuario extends Model<FuncaoUsuarioAttributes, FuncaoUsuarioCreationAttributes> implements FuncaoUsuarioAttributes {
    public id!: number;
    public funcaoUsuario!: string;

    static initialize(sequelize: Sequelize) {
        FuncaoUsuario.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            funcaoUsuario: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true
            }
        }, {
            sequelize,
            modelName: "FuncaoUsuario",
            freezeTableName: true
        });
    }

    static associate(models: any) {
        FuncaoUsuario.hasMany(models.Usuario, {
            foreignKey: 'idFuncaoUsuario',
            as: 'usuario'
        });
    }
}

interface FuncaoUsuarioAcessoAttributes {
    id: number;
    idFuncaoSistema: number;
    idFuncaoUsuario: number;
}

interface FuncaoUsuarioAcessoCreationAttributes extends Optional<FuncaoUsuarioAcessoAttributes, 'id'> { }

class FuncaoUsuarioAcesso extends Model<FuncaoUsuarioAcessoAttributes, FuncaoUsuarioAcessoCreationAttributes> implements FuncaoUsuarioAcessoAttributes {
    public id!: number;
    public idFuncaoSistema!: number;
    public idFuncaoUsuario!: number;

    static initialize(sequelize: Sequelize) {
        FuncaoUsuarioAcesso.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idFuncaoSistema: {
                type: DataTypes.INTEGER,
                references: {
                    model: FuncaoSistema,
                    key: 'id'
                }
            },
            idFuncaoUsuario: {
                type: DataTypes.INTEGER,
                references: {
                    model: FuncaoUsuario,
                    key: 'id'
                }
            }
        }, {
            sequelize,
            modelName: "FuncaoUsuarioAcesso",
            freezeTableName: true
        });
    }

    static associate() {
        FuncaoUsuarioAcesso.belongsTo(FuncaoSistema, {
            foreignKey: 'idFuncaoSistema',
            as: 'funcaoSistema' // Alias para a relação
        });

        FuncaoUsuarioAcesso.belongsTo(FuncaoUsuario, {
            foreignKey: 'idFuncaoUsuario',
            as: 'funcaoUsuario' // Alias para a relação
        });
    }
}

interface UsuarioAttributes {
    id: number;
    email: string;
    login: string;
    senha?: string;
    nomeCompleto?: string;
    sobreNome?: string;
    ativo?: boolean;
    alterarSenha?: boolean;
    token?: string;
    idFuncaoUsuario?: number;
    cpf?: string;
    telefone?: string;
    id_cliente?: number;
    admGeral?: boolean; // Atributo para indicar se o usuário é administrador geral
}

interface UsuarioCreationAttributes extends Optional<UsuarioAttributes, 'id' | 'senha'> { }

class Usuario extends Model<UsuarioAttributes, UsuarioCreationAttributes> implements UsuarioAttributes {
    public id!: number;
    public email!: string;
    public login!: string;
    public senha?: string;
    public nomeCompleto?: string;
    public sobreNome?: string;
    public ativo?: boolean;
    public alterarSenha?: boolean;
    public token?: string;
    public idFuncaoUsuario?: number;
    public cpf?: string;
    public telefone?: string;
    public id_cliente?: number;
    public admGeral?: boolean; // Atributo para indicar se o usuário é administrador geral

    static initialize(sequelize: Sequelize) {
        Usuario.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            email: {
                type: DataTypes.STRING,
                unique: true,
                validate: {
                    isEmail: true
                }
            },
            login: {
                type: DataTypes.STRING,
                unique: true
            },
            senha: DataTypes.STRING,
            nomeCompleto: DataTypes.STRING,
            sobreNome: DataTypes.STRING,
            ativo: DataTypes.BOOLEAN,
            alterarSenha: {
                type: DataTypes.BOOLEAN,
                defaultValue: false
            },
            token: DataTypes.STRING,
            idFuncaoUsuario: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: FuncaoUsuario,
                    key: 'id'
                }
            },
            cpf: {
                type: DataTypes.STRING,
                validate: {
                    is: /^\d{3}\.\d{3}\.\d{3}-\d{2}$/
                }
            },
            telefone: {
                type: DataTypes.STRING,
                validate: {
                    is: /^\(\d{2}\) \d{4,5}-\d{4}$/
                }
            },
            id_cliente: {
                type: DataTypes.INTEGER,
                allowNull: true
            },
            admGeral: {
                type: DataTypes.BOOLEAN,
                defaultValue: false // Define se o usuário é administrador geral
            }
        }, {
            sequelize,
            modelName: "Usuario",
            freezeTableName: true,
            hooks: {
                beforeSave: async (usuario: Usuario) => {
                    if (usuario.senha && usuario.changed('senha')) {
                        usuario.senha = await bcrypt.hash(usuario.senha, 10);
                    }
                }
            }
        });
    }

    static associate(models: any) {
        Usuario.belongsTo(models.FuncaoUsuario, {
            foreignKey: 'idFuncaoUsuario',
            as: 'funcaoUsuario'
        });
    }

    // Método para verificar senha
    public async verifyPassword(senha: string): Promise<boolean> {
        return bcrypt.compare(senha, this.senha || '');
    }
}

interface UsuarioEmpresaAttributes {
    id: number;
    usuarioId: number;
    empresaId: number;
}

interface UsuarioEmpresaCreationAttributes extends Optional<UsuarioEmpresaAttributes, 'id'> { }

class UsuarioEmpresa extends Model<UsuarioEmpresaAttributes, UsuarioEmpresaCreationAttributes> implements UsuarioEmpresaAttributes {
    public id!: number;
    public usuarioId!: number;
    public empresaId!: number;

    static initialize(sequelize: Sequelize) {
        UsuarioEmpresa.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            usuarioId: {
                type: DataTypes.INTEGER,
                references: {
                    model: Usuario,
                    key: 'id'
                }
            },
            empresaId: {
                type: DataTypes.INTEGER,
                references: {
                    model: Empresa,
                    key: 'id'
                }
            }
        }, {
            sequelize,
            modelName: "UsuarioEmpresa",
            freezeTableName: true
        });
    }

    static associate(models: any) {
        UsuarioEmpresa.belongsTo(models.Usuario, {
            foreignKey: 'usuarioId',
            as: 'usuario'
        });
        UsuarioEmpresa.belongsTo(models.Empresa, {
            foreignKey: 'empresaId',
            as: 'empresa'
        });
    }
}

// Função para inicializar todos os modelos
export const UsuarioInit = (sequelize: Sequelize) => {
    FuncaoSistema.initialize(sequelize);
    FuncaoUsuario.initialize(sequelize);
    FuncaoUsuarioAcesso.initialize(sequelize);
    Usuario.initialize(sequelize);
    UsuarioEmpresa.initialize(sequelize);

    // Associações entre os modelos
    FuncaoUsuario.associate({ Usuario });
    Usuario.associate({ FuncaoUsuario });
    UsuarioEmpresa.associate({ Usuario, Empresa });
    FuncaoUsuarioAcesso.associate();
}

export {
    FuncaoSistema,
    FuncaoUsuario,
    FuncaoUsuarioAcesso,
    Usuario,
    UsuarioEmpresa
};
