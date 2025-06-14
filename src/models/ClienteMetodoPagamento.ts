import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface UsuarioMetodoPagamentoAttributes {
    id: number;
    idUsuario: number;
    dados: string;
}

interface UsuarioMetodoPagamentoCreationAttributes extends Optional<UsuarioMetodoPagamentoAttributes, 'id'> { }

class UsuarioMetodoPagamento extends Model<UsuarioMetodoPagamentoAttributes, UsuarioMetodoPagamentoCreationAttributes> implements UsuarioMetodoPagamentoAttributes {
    public id!: number;
    public idUsuario!: number;
    public dados!: string;

    static initialize(sequelize: Sequelize) {
        UsuarioMetodoPagamento.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            idUsuario: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'Usuario', // Nome da tabela referenciada
                    key: 'id' // Chave primária da tabela referenciada
                },
            },
            dados: {
                type: DataTypes.TEXT,
                allowNull: false
            }
        }, {
            sequelize,
            modelName: "UsuarioMetodoPagamento",
            freezeTableName: true,
        });
    }
}

export const UsuarioMetodoPagamentoInit = (sequelize: Sequelize) => {
    UsuarioMetodoPagamento.initialize(sequelize);
}

export {
    UsuarioMetodoPagamento,
};
