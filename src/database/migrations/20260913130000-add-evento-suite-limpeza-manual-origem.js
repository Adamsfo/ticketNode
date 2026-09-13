"use strict";

/**
 * Limpeza manual de suíte (sem ReservaHospedagem / ReservaSuite).
 * Equivalente a scripts/alter-evento-suite-limpeza-manual.sql.
 *
 * - origem CHECKOUT | MANUAL (registros existentes → CHECKOUT via DEFAULT)
 * - id_reserva_hospedagem e id_reserva_suite passam a aceitar NULL
 * - UNIQUE uq_limpeza_reserva_suite permanece inalterada
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("EventoSuiteLimpeza", "origem", {
      type: Sequelize.ENUM("CHECKOUT", "MANUAL"),
      allowNull: false,
      defaultValue: "CHECKOUT",
      after: "status",
    });

    await queryInterface.sequelize.query(`
      UPDATE EventoSuiteLimpeza
      SET origem = 'CHECKOUT'
      WHERE origem IS NULL OR origem = ''
    `);

    await queryInterface.changeColumn(
      "EventoSuiteLimpeza",
      "id_reserva_hospedagem",
      {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: "ReservaHospedagem",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      }
    );

    await queryInterface.changeColumn(
      "EventoSuiteLimpeza",
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
      }
    );
  },

  async down(queryInterface, Sequelize) {
    const [rows] = await queryInterface.sequelize.query(`
      SELECT COUNT(*) AS total
      FROM EventoSuiteLimpeza
      WHERE origem = 'MANUAL'
         OR id_reserva_hospedagem IS NULL
         OR id_reserva_suite IS NULL
    `);

    const total = Number(rows?.[0]?.total ?? 0);
    if (total > 0) {
      throw new Error(
        "Não é possível reverter: existem limpezas MANUAL ou sem vínculo de reserva."
      );
    }

    await queryInterface.changeColumn(
      "EventoSuiteLimpeza",
      "id_reserva_hospedagem",
      {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "ReservaHospedagem",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      }
    );

    await queryInterface.changeColumn(
      "EventoSuiteLimpeza",
      "id_reserva_suite",
      {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "ReservaSuite",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      }
    );

    await queryInterface.removeColumn("EventoSuiteLimpeza", "origem");
  },
};
