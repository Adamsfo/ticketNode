"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsuarioEmpresa = exports.Usuario = exports.FuncaoUsuarioAcesso = exports.FuncaoUsuario = exports.FuncaoSistema = exports.UsuarioInit = void 0;
const sequelize_1 = require("sequelize");
const Empresa_1 = require("./Empresa");
const bcrypt = require('bcrypt');
class FuncaoSistema extends sequelize_1.Model {
    static initialize(sequelize) {
        FuncaoSistema.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            funcaoSistema: {
                type: sequelize_1.DataTypes.STRING,
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
exports.FuncaoSistema = FuncaoSistema;
class FuncaoUsuario extends sequelize_1.Model {
    static initialize(sequelize) {
        FuncaoUsuario.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            funcaoUsuario: {
                type: sequelize_1.DataTypes.STRING,
                allowNull: false,
                unique: true
            }
        }, {
            sequelize,
            modelName: "FuncaoUsuario",
            freezeTableName: true
        });
    }
    static associate(models) {
        FuncaoUsuario.hasMany(models.Usuario, {
            foreignKey: 'idFuncaoUsuario',
            as: 'usuario'
        });
    }
}
exports.FuncaoUsuario = FuncaoUsuario;
class FuncaoUsuarioAcesso extends sequelize_1.Model {
    static initialize(sequelize) {
        FuncaoUsuarioAcesso.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idFuncaoSistema: {
                type: sequelize_1.DataTypes.INTEGER,
                references: {
                    model: FuncaoSistema,
                    key: 'id'
                }
            },
            idFuncaoUsuario: {
                type: sequelize_1.DataTypes.INTEGER,
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
exports.FuncaoUsuarioAcesso = FuncaoUsuarioAcesso;
class Usuario extends sequelize_1.Model {
    static initialize(sequelize) {
        Usuario.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            email: {
                type: sequelize_1.DataTypes.STRING,
                // unique: true,
                // validate: {
                //     isEmail: true
                // },
                allowNull: true
            },
            login: {
                type: sequelize_1.DataTypes.STRING,
                unique: true
            },
            senha: sequelize_1.DataTypes.STRING,
            nomeCompleto: sequelize_1.DataTypes.STRING,
            sobreNome: sequelize_1.DataTypes.STRING,
            ativo: sequelize_1.DataTypes.BOOLEAN,
            alterarSenha: {
                type: sequelize_1.DataTypes.BOOLEAN,
                defaultValue: false
            },
            token: sequelize_1.DataTypes.STRING,
            idFuncaoUsuario: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: FuncaoUsuario,
                    key: 'id'
                }
            },
            cpf: {
                type: sequelize_1.DataTypes.STRING,
                validate: {
                    is: /^\d{3}\.\d{3}\.\d{3}-\d{2}$/
                }
            },
            telefone: {
                type: sequelize_1.DataTypes.STRING,
                validate: {
                    is: /^\(\d{2}\) \d{4,5}-\d{4}$/
                },
                allowNull: true
            },
            id_cliente: {
                type: sequelize_1.DataTypes.INTEGER,
                allowNull: true
            },
            admGeral: {
                type: sequelize_1.DataTypes.BOOLEAN,
                defaultValue: false // Define se o usuário é administrador geral
            },
            preCadastro: {
                type: sequelize_1.DataTypes.BOOLEAN,
                defaultValue: false // Define se o usuário é um pré-cadastro
            }
        }, {
            sequelize,
            modelName: "Usuario",
            freezeTableName: true,
            hooks: {
                beforeSave: async (usuario) => {
                    if (usuario.senha && usuario.changed('senha')) {
                        usuario.senha = await bcrypt.hash(usuario.senha, 10);
                    }
                }
            }
        });
    }
    static associate(models) {
        Usuario.belongsTo(models.FuncaoUsuario, {
            foreignKey: 'idFuncaoUsuario',
            as: 'funcaoUsuario'
        });
    }
    // Método para verificar senha
    async verifyPassword(senha) {
        return bcrypt.compare(senha, this.senha || '');
    }
}
exports.Usuario = Usuario;
class UsuarioEmpresa extends sequelize_1.Model {
    static initialize(sequelize) {
        UsuarioEmpresa.init({
            id: {
                type: sequelize_1.DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            usuarioId: {
                type: sequelize_1.DataTypes.INTEGER,
                references: {
                    model: Usuario,
                    key: 'id'
                }
            },
            empresaId: {
                type: sequelize_1.DataTypes.INTEGER,
                references: {
                    model: Empresa_1.Empresa,
                    key: 'id'
                }
            }
        }, {
            sequelize,
            modelName: "UsuarioEmpresa",
            freezeTableName: true
        });
    }
    static associate(models) {
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
exports.UsuarioEmpresa = UsuarioEmpresa;
// Função para inicializar todos os modelos
const UsuarioInit = (sequelize) => {
    FuncaoSistema.initialize(sequelize);
    FuncaoUsuario.initialize(sequelize);
    FuncaoUsuarioAcesso.initialize(sequelize);
    Usuario.initialize(sequelize);
    UsuarioEmpresa.initialize(sequelize);
    // Associações entre os modelos
    FuncaoUsuario.associate({ Usuario });
    Usuario.associate({ FuncaoUsuario });
    UsuarioEmpresa.associate({ Usuario, Empresa: Empresa_1.Empresa });
    FuncaoUsuarioAcesso.associate();
};
exports.UsuarioInit = UsuarioInit;
