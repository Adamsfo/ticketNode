import { DataTypes, Model, Optional, Sequelize } from 'sequelize';

interface VisitasAttributes {
    id: number;
    quantidade: number;
}

interface VisitasCreationAttributes extends Optional<VisitasAttributes, 'id'> { }

class Visitas extends Model<VisitasAttributes, VisitasCreationAttributes> implements VisitasAttributes {
    public id!: number;
    public quantidade!: number;

    static initialize(sequelize: Sequelize) {
        Visitas.init({
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            quantidade: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                validate: {
                    isInt: true,
                    min: 0
                }
            }
        }, {
            sequelize,
            modelName: "Visitas",
            freezeTableName: true,
        });
    }
}

export const VisitasInit = (sequelize: Sequelize) => {
    Visitas.initialize(sequelize);
}

export {
    Visitas,
};
