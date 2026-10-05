import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    escolherCaixaAbertoPreferido,
    isCaixaPdvAberto,
} from './caixaPdvAberto';

describe('isCaixaPdvAberto', () => {
    it('aberto quando DATA_FECHAMENTO é null', () => {
        assert.equal(isCaixaPdvAberto({ dataFechamento: null }), true);
    });

    it('fechado quando DATA_FECHAMENTO preenchido', () => {
        assert.equal(
            isCaixaPdvAberto({ dataFechamento: '2026-10-05 18:00:00' }),
            false
        );
    });

    it('fechado quando STATUS indica fechamento', () => {
        assert.equal(
            isCaixaPdvAberto({ dataFechamento: null, status: 'FECHADO' }),
            false
        );
    });
});

describe('escolherCaixaAbertoPreferido', () => {
    it('retorna o maior ID_CAIXA entre abertos', () => {
        const escolhido = escolherCaixaAbertoPreferido([
            {
                idCaixa: 10,
                dataAbertura: null,
                dataFechamento: null,
                status: null,
            },
            {
                idCaixa: 25,
                dataAbertura: null,
                dataFechamento: null,
                status: null,
            },
        ]);
        assert.equal(escolhido?.idCaixa, 25);
    });
});
