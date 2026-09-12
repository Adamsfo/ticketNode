"use strict";

/**
 * Operação individual por ReservaSuite: check-out por linha.
 * Espelha os campos equivalentes de ReservaHospedagem (data/hora + usuário).
 * Não altera ReservaHospedagem nem backfill de dados legados.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      "ReservaSuite",
      "data_hora_checkout_realizado",
      {
        type: Sequelize.DATE,
        allowNull: true,
        after: "id_usuario_checkin",
      }
    );

    await queryInterface.addColumn("ReservaSuite", "id_usuario_checkout", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: "Usuario",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
      after: "data_hora_checkout_realizado",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("ReservaSuite", "id_usuario_checkout");
    await queryInterface.removeColumn(
      "ReservaSuite",
      "data_hora_checkout_realizado"
    );
  },
};
