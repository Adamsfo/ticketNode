import { DataTypes, Model, Optional, Sequelize } from 'sequelize';
import { Evento } from './Evento';
import { Usuario } from './Usuario';

interface HospedagemFechamentoExcepcionalAttributes {
    id: number;
    idEvento: number;
    dataInicio: string;
    dataFim: string;
    motivo: string | null;
    ativo: boolean;
    idUsuarioCriacao: number | null;
    idUsuarioAtualizacao: number | null;
    createdAt?: Date;
    updatedAt?: Date;
}

type Creation = Optional<
    HospedagemFechamentoExcepcionalAttributes,
    | 'id'
    | 'motivo'
    | 'ativo'
    | 'idUsuarioCriacao'
    | 'idUsuarioAtualizacao'
    | 'createdAt'
    | 'updatedAt'
>;

class HospedagemFechamentoExcepcional
    extends Model<
        HospedagemFechamentoExcepcionalAttributes,
        Creation
    >
    implements HospedagemFechamentoExcepcionalAttributes
{
    public id!: number;
    public idEvento!: number;
    public dataInicio!: string;
    public dataFim!: string;
    public motivo!: string | null;
    public ativo!: boolean;
    public idUsuarioCriacao!: number | null;
    public idUsuarioAtualizacao!: number | null;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    static initialize(sequelize: Sequelize) {
        HospedagemFechamentoExcepcional.init(
            {
                id: {
                    type: DataTypes.INTEGER,
                    autoIncrement: true,
                    primaryKey: true,
                },
                idEvento: {
                    type: DataTypes.INTEGER,
                    allowNull: false,
                    references: { model: Evento, key: 'id' },
                },
                dataInicio: {
                    type: DataTypes.DATEONLY,
                    allowNull: false,
                },
                dataFim: {
                    type: DataTypes.DATEONLY,
                    allowNull: false,
                },
                motivo: {
                    type: DataTypes.STRING(500),
                    allowNull: true,
                },
                ativo: {
                    type: DataTypes.BOOLEAN,
                    allowNull: false,
                    defaultValue: true,
                },
                idUsuarioCriacao: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                    references: { model: Usuario, key: 'id' },
                },
                idUsuarioAtualizacao: {
                    type: DataTypes.INTEGER,
                    allowNull: true,
                    references: { model: Usuario, key: 'id' },
                },
            },
            {
                sequelize,
                modelName: 'HospedagemFechamentoExcepcional',
                tableName: 'HospedagemFechamentoExcepcional',
                freezeTableName: true,
                underscored: true,
                timestamps: true,
            }
        );
    }
}

export const HospedagemFechamentoExcepcionalInit = (sequelize: Sequelize) => {
    HospedagemFechamentoExcepcional.initialize(sequelize);
};

export { HospedagemFechamentoExcepcional };
