import assert from "node:assert";
import { describe, it } from "node:test";
import { Op } from "sequelize";
import {
    buildWhereExcluirUtilizadoCanceladoListagemCortesia,
    deveExcluirUtilizadoCanceladoListagemCortesia,
    INGRESSO_STATUS_CANCELADO,
    INGRESSO_STATUS_UTILIZADO,
} from "./ingressoCortesiaListagemFilter";

describe("ingressoCortesiaListagemFilter", () => {
    it("detecta flag da listagem de cortesias", () => {
        assert.strictEqual(
            deveExcluirUtilizadoCanceladoListagemCortesia({
                excluirUtilizadoCancelado: true,
            }),
            true,
        );
        assert.strictEqual(
            deveExcluirUtilizadoCanceladoListagemCortesia({
                excluirUtilizadoCancelado: "true",
            }),
            true,
        );
        assert.strictEqual(deveExcluirUtilizadoCanceladoListagemCortesia({}), false);
    });

    it("exclui Utilizado e Cancelado na consulta", () => {
        const where = buildWhereExcluirUtilizadoCanceladoListagemCortesia();
        assert.deepStrictEqual(where.status[Op.notIn], [
            INGRESSO_STATUS_UTILIZADO,
            INGRESSO_STATUS_CANCELADO,
        ]);
    });
});
