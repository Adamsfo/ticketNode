import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    STATUS_CATALOGO_DISPONIBILIDADE_INTERNO,
    STATUS_CATALOGO_DISPONIBILIDADE_PUBLICO,
    STATUS_COTACAO_INTERNA,
    STATUS_COTACAO_PUBLICA,
    statusesCatalogoDisponibilidade,
    statusesPermitidosCotacao,
} from './reservaSuiteService';

describe('catálogo de suítes — visibilidade Oculto', () => {
    it('disponibilidade pública inclui somente Ativo', () => {
        assert.deepEqual(
            [...statusesCatalogoDisponibilidade(false)],
            [...STATUS_CATALOGO_DISPONIBILIDADE_PUBLICO]
        );
        assert.ok(!STATUS_CATALOGO_DISPONIBILIDADE_PUBLICO.includes('Oculto'));
    });

    it('disponibilidade interna inclui Ativo, PDV e Oculto', () => {
        assert.deepEqual(
            [...statusesCatalogoDisponibilidade(true)],
            [...STATUS_CATALOGO_DISPONIBILIDADE_INTERNO]
        );
    });

    it('cotação pública bloqueia Oculto', () => {
        assert.ok(STATUS_COTACAO_PUBLICA.includes('Ativo'));
        assert.ok(STATUS_COTACAO_PUBLICA.includes('PDV'));
        assert.ok(!STATUS_COTACAO_PUBLICA.includes('Oculto'));
        assert.ok(!statusesPermitidosCotacao(false).includes('Oculto'));
    });

    it('cotação interna permite Oculto', () => {
        assert.ok(STATUS_COTACAO_INTERNA.includes('Oculto'));
        assert.ok(statusesPermitidosCotacao(true).includes('Oculto'));
    });
});
