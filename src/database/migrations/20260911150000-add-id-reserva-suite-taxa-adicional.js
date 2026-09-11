"use strict";

/**
 * Vínculo opcional da taxa adicional com a linha ReservaSuite (identificação/organização).
 * Nullable — taxas legadas permanecem sem suíte (exibidas como "Reserva").
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      "ReservaHospedagemTaxaAdicional",
      "id_reserva_suite",
      {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: "ReservaSuite",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
        after: "id_reserva_hospedagem",
      }
    );

    await queryInterface.addIndex(
      "ReservaHospedagemTaxaAdicional",
      ["id_reserva_suite"],
      {
        name: "idx_reserva_hospedagem_taxa_suite",
      }
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      "ReservaHospedagemTaxaAdicional",
      "idx_reserva_hospedagem_taxa_suite"
    );

    await queryInterface.removeColumn(
      "ReservaHospedagemTaxaAdicional",
      "id_reserva_suite"
    );
  },
};
