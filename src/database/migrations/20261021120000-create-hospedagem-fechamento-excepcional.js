"use strict";

/**
 * Cria HospedagemFechamentoExcepcional — fechamentos excepcionais da pousada (datas/intervalos).
 * Forma oficial de criação do schema (ver também scripts/create-hospedagem-fechamento-excepcional.sql como auxiliar manual).
 * Regra semanal (terça/quarta) permanece no código; esta tabela só cobre exceções.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("HospedagemFechamentoExcepcional", {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      id_evento: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      data_inicio: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      data_fim: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      motivo: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      ativo: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      id_usuario_criacao: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      id_usuario_atualizacao: {
        type: Sequelize.INTEGER,
        allowNull: true,
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

    await queryInterface.addConstraint("HospedagemFechamentoExcepcional", {
      fields: ["id_evento"],
      type: "foreign key",
      name: "fk_hfe_evento",
      references: {
        table: "Evento",
        field: "id",
      },
    });

    await queryInterface.addConstraint("HospedagemFechamentoExcepcional", {
      fields: ["id_usuario_criacao"],
      type: "foreign key",
      name: "fk_hfe_usuario_criacao",
      references: {
        table: "Usuario",
        field: "id",
      },
    });

    await queryInterface.addConstraint("HospedagemFechamentoExcepcional", {
      fields: ["id_usuario_atualizacao"],
      type: "foreign key",
      name: "fk_hfe_usuario_atualizacao",
      references: {
        table: "Usuario",
        field: "id",
      },
    });

    await queryInterface.addIndex(
      "HospedagemFechamentoExcepcional",
      ["id_evento", "ativo", "data_inicio", "data_fim"],
      {
        name: "idx_hfe_evento_ativo_datas",
      }
    );

    await queryInterface.sequelize.query(`
      ALTER TABLE HospedagemFechamentoExcepcional
      ADD CONSTRAINT chk_hfe_intervalo CHECK (data_fim >= data_inicio)
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("HospedagemFechamentoExcepcional");
  },
};
