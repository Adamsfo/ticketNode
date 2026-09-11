"use strict";

/**
 * Cria ReservaHospedagemTaxaAdicional — taxas adicionais manuais ao nível da reserva.
 * Forma oficial de criação do schema (ver também scripts/create-reserva-hospedagem-taxa-adicional.sql como auxiliar manual).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ReservaHospedagemTaxaAdicional", {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      id_reserva_hospedagem: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "ReservaHospedagem",
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
      "ReservaHospedagemTaxaAdicional",
      ["id_reserva_hospedagem"],
      {
        name: "idx_reserva_hospedagem_taxa_reserva",
      }
    );

    await queryInterface.addIndex(
      "ReservaHospedagemTaxaAdicional",
      ["id_reserva_hospedagem", "ordem"],
      {
        name: "idx_reserva_hospedagem_taxa_ordem",
      }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ReservaHospedagemTaxaAdicional");
  },
};
