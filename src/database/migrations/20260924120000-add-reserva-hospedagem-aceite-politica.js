"use strict";

/**
 * Aceite da Política de Cancelamento, Remarcação e Alteração de Hóspedes.
 * Reservas existentes: aceite 0, datas/versão NULL (default da coluna).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      "ReservaHospedagem",
      "aceite_politica_hospedagem",
      {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      }
    );

    await queryInterface.addColumn(
      "ReservaHospedagem",
      "data_aceite_politica_hospedagem",
      {
        type: Sequelize.DATE,
        allowNull: true,
      }
    );

    await queryInterface.addColumn(
      "ReservaHospedagem",
      "versao_politica_hospedagem",
      {
        type: Sequelize.STRING(32),
        allowNull: true,
      }
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn(
      "ReservaHospedagem",
      "versao_politica_hospedagem"
    );
    await queryInterface.removeColumn(
      "ReservaHospedagem",
      "data_aceite_politica_hospedagem"
    );
    await queryInterface.removeColumn(
      "ReservaHospedagem",
      "aceite_politica_hospedagem"
    );
  },
};
