"use strict";

/**
 * Operação individual por ReservaSuite: chegada e check-in por linha.
 * Espelha os campos equivalentes de ReservaHospedagem (data/hora + usuário).
 * Não altera ReservaHospedagem nem backfill de dados legados.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      "ReservaSuite",
      "data_hora_chegada_real",
      {
        type: Sequelize.DATE,
        allowNull: true,
        after: "hospedin_reservation_id",
      }
    );

    await queryInterface.addColumn("ReservaSuite", "id_usuario_chegada", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: "Usuario",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
      after: "data_hora_chegada_real",
    });

    await queryInterface.addColumn(
      "ReservaSuite",
      "data_hora_checkin_real",
      {
        type: Sequelize.DATE,
        allowNull: true,
        after: "id_usuario_chegada",
      }
    );

    await queryInterface.addColumn("ReservaSuite", "id_usuario_checkin", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: "Usuario",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
      after: "data_hora_checkin_real",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("ReservaSuite", "id_usuario_checkin");
    await queryInterface.removeColumn("ReservaSuite", "data_hora_checkin_real");
    await queryInterface.removeColumn("ReservaSuite", "id_usuario_chegada");
    await queryInterface.removeColumn("ReservaSuite", "data_hora_chegada_real");
  },
};
