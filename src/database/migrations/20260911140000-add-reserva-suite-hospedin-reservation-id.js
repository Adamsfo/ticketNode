"use strict";

/**
 * Outbound Jango → Hospedin: vínculo da reservation Hospedin por linha de suíte.
 * Nullable — reservas legadas continuam usando ReservaHospedagem.id_externo até backfill futuro.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("ReservaSuite", "hospedin_reservation_id", {
      type: Sequelize.STRING(64),
      allowNull: true,
      after: "status",
    });

    await queryInterface.addIndex("ReservaSuite", ["hospedin_reservation_id"], {
      name: "idx_reserva_suite_hospedin_reservation_id",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      "ReservaSuite",
      "idx_reserva_suite_hospedin_reservation_id"
    );

    await queryInterface.removeColumn(
      "ReservaSuite",
      "hospedin_reservation_id"
    );
  },
};
