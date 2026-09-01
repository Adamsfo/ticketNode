/**
 * Testes — merge/split de observações da reserva.
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/utils/reservaObservacoesUtils.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    applyObservacaoImportadaUpdate,
    mergeReservaObservacoes,
    splitOperadorFromTextoCompleto,
} from './reservaObservacoesUtils';

const IMPORTADA = 'Cliente Lilian\nPago tudo\nFalta nota';

describe('mergeReservaObservacoes', () => {
    it('retorna vazio quando ambas partes ausentes', () => {
        assert.equal(mergeReservaObservacoes(null, null), '');
    });

    it('une importada e operador com linha em branco', () => {
        const merged = mergeReservaObservacoes(IMPORTADA, 'Ligar antes do check-in.');
        assert.equal(
            merged,
            'Cliente Lilian\nPago tudo\nFalta nota\n\nLigar antes do check-in.'
        );
    });
});

describe('splitOperadorFromTextoCompleto', () => {
    it('extrai operador após importada inalterada', () => {
        const texto = `${IMPORTADA}\n\nLigar antes do check-in.\n\nCobrar taxa do pet.`;
        const partes = splitOperadorFromTextoCompleto(texto, IMPORTADA);
        assert.equal(partes.observacaoImportada, IMPORTADA);
        assert.equal(
            partes.observacaoOperador,
            'Ligar antes do check-in.\n\nCobrar taxa do pet.'
        );
    });

    it('mantém importada quando operador não alterou', () => {
        const partes = splitOperadorFromTextoCompleto(IMPORTADA, IMPORTADA);
        assert.equal(partes.observacaoImportada, IMPORTADA);
        assert.equal(partes.observacaoOperador, null);
    });

    it('grava texto inteiro como operador quando importada foi reescrita', () => {
        const texto = 'Cliente Maria\nPago parcial';
        const partes = splitOperadorFromTextoCompleto(texto, IMPORTADA);
        assert.equal(partes.observacaoImportada, null);
        assert.equal(partes.observacaoOperador, texto);
    });
});

describe('applyObservacaoImportadaUpdate', () => {
    it('atualiza importada e preserva operador no merge', () => {
        const op = 'Ligar antes do check-in.';
        const result = applyObservacaoImportadaUpdate('Nova nota Hospedin', op);
        assert.equal(result.observacaoImportada, 'Nova nota Hospedin');
        assert.equal(result.observacaoOperador, op);
        assert.equal(
            result.observacoes,
            'Nova nota Hospedin\n\nLigar antes do check-in.'
        );
    });
});
