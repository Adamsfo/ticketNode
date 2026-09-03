/**
 * Capacidade de hóspedes — fluxo público vs operações administrativas
 * (troca de suíte, alterar período, listagem para troca).
 *
 * Admin usa validarCapacidadeMaximaPousada (só teto). Público usa calcularExtrasPousada.
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/utils/reservaSuiteUtils.capacidade.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    calcularExtrasPousada,
    validarCapacidadeMaximaPousada,
} from './reservaSuiteUtils';

function assertThrowsMin(fn: () => unknown) {
    assert.throws(fn, (err: Error) =>
        /requer no mínimo/i.test(String(err.message || err))
    );
}

function assertThrowsMax(fn: () => unknown) {
    assert.throws(fn, (err: Error) =>
        /permite no máximo/i.test(String(err.message || err))
    );
}

describe('fluxo administrativo — validarCapacidadeMaximaPousada', () => {
    it('CASO 1: alterar período — 2 hóspedes em suíte min=3 max=6 é permitido', () => {
        assert.doesNotThrow(() =>
            validarCapacidadeMaximaPousada(2, 0, 6, 3)
        );
    });

    it('CASO 2: troca de suíte — 2 hóspedes em suíte destino min=3 max=6 é permitido', () => {
        assert.doesNotThrow(() =>
            validarCapacidadeMaximaPousada(2, 0, 6, 3)
        );
        assert.throws(
            () => calcularExtrasPousada(2, 0, 3, 6),
            (err: Error) => /requer no mínimo/i.test(String(err.message || err))
        );
    });

    it('acima do máximo continua bloqueado no admin', () => {
        assertThrowsMax(() => validarCapacidadeMaximaPousada(3, 0, 2, 1));
    });

    it('suíte compatível (2 em min=1 max=2) continua ok', () => {
        assert.doesNotThrow(() =>
            validarCapacidadeMaximaPousada(2, 0, 2, 1)
        );
        const extras = calcularExtrasPousada(2, 0, 1, 2);
        assert.ok(extras);
        assert.equal(extras.total, 2);
    });

    it('não altera adultos/crianças (validação pura, sem efeito colateral)', () => {
        const adultos = 2;
        const criancas = 0;
        validarCapacidadeMaximaPousada(adultos, criancas, 6, 3);
        assert.equal(adultos, 2);
        assert.equal(criancas, 0);
    });
});

describe('fluxo público — calcularExtrasPousada', () => {
    it('CASO 3: 2 hóspedes em suíte min=3 max=6 continua bloqueado', () => {
        assertThrowsMin(() => calcularExtrasPousada(2, 0, 3, 6));
    });

    it('acima do máximo continua bloqueado no fluxo público', () => {
        assertThrowsMax(() => calcularExtrasPousada(3, 0, 1, 2));
    });
});
