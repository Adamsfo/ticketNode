"use strict";

/**
 * Cria ReservaSuiteItemServico — serviços adicionais por linha de suíte.
 * Forma oficial de criação do schema (ver também scripts/create-reserva-suite-item-servico.sql como auxiliar manual).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ReservaSuiteItemServico", {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      id_reserva_suite: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "ReservaSuite",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      descricao: {
        type: Sequelize.STRING(500),
        allowNull: false,
      },
      valor: {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: false,
      },
      ordem: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      id_usuario_criacao: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: "Usuario",
          key: "id",
        },
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal(
          "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
        ),
      },
    });

    await queryInterface.addIndex(
      "ReservaSuiteItemServico",
      ["id_reserva_suite"],
      {
        name: "idx_reserva_suite_item_servico_suite",
      }
    );

    await queryInterface.addIndex(
      "ReservaSuiteItemServico",
      ["id_reserva_suite", "ordem"],
      {
        name: "idx_reserva_suite_item_servico_ordem",
      }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ReservaSuiteItemServico");
  },
};
