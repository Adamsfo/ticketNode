import assert from "node:assert";
import { describe, it } from "node:test";
import { buildIngressoSearchConditions } from "./ingressoSearch";

describe("buildIngressoSearchConditions", () => {
  it("retorna vazio para busca em branco", () => {
    assert.deepStrictEqual(buildIngressoSearchConditions(""), []);
    assert.deepStrictEqual(buildIngressoSearchConditions("   "), []);
  });

  it("busca só por código quando a entrada é numérica", () => {
    const conditions = buildIngressoSearchConditions("4521");
    assert.strictEqual(conditions.length, 1);
    assert.ok(conditions[0].id);
  });

  it("inclui campos de texto e associações quando há letras", () => {
    const conditions = buildIngressoSearchConditions("Maria");
    assert.ok(conditions.some((c) => c.nomeImpresso));
    assert.ok(conditions.some((c) => c["$Usuario.nome_completo$"]));
    assert.ok(conditions.some((c) => c["$EventoIngresso.nome$"]));
    assert.ok(conditions.some((c) => c["$TipoIngresso.descricao$"]));
  });
});
