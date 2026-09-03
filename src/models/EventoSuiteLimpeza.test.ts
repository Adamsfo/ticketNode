import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    STATUS_EVENTO_SUITE_LIMPEZA,
    StatusEventoSuiteLimpeza,
    isLimpezaAberta,
    podeConcluirLimpeza,
    podeIniciarLimpeza,
} from './EventoSuiteLimpeza';

describe('StatusEventoSuiteLimpeza', () => {
    it('possui exatamente Pendente, EmAndamento e Concluida', () => {
        assert.deepEqual(STATUS_EVENTO_SUITE_LIMPEZA, [
            StatusEventoSuiteLimpeza.Pendente,
            StatusEventoSuiteLimpeza.EmAndamento,
            StatusEventoSuiteLimpeza.Concluida,
        ]);
    });

    it('não inclui status de reserva nem de catálogo da suíte', () => {
        const valores = new Set(STATUS_EVENTO_SUITE_LIMPEZA);
        assert.equal(valores.has('EmLimpeza' as StatusEventoSuiteLimpeza), false);
        assert.equal(valores.has('Hospedada' as StatusEventoSuiteLimpeza), false);
        assert.equal(valores.has('CheckOutRealizado' as StatusEventoSuiteLimpeza), false);
        assert.equal(valores.has('Livre' as StatusEventoSuiteLimpeza), false);
        assert.equal(valores.has('Ativo' as StatusEventoSuiteLimpeza), false);
    });
});

describe('isLimpezaAberta', () => {
    it('Pendente e EmAndamento estão abertas', () => {
        assert.equal(isLimpezaAberta(StatusEventoSuiteLimpeza.Pendente), true);
        assert.equal(isLimpezaAberta(StatusEventoSuiteLimpeza.EmAndamento), true);
    });

    it('Concluida não está aberta', () => {
        assert.equal(isLimpezaAberta(StatusEventoSuiteLimpeza.Concluida), false);
    });

    it('status desconhecido não está aberto', () => {
        assert.equal(isLimpezaAberta(''), false);
        assert.equal(isLimpezaAberta('Hospedada'), false);
    });
});

describe('transições de limpeza', () => {
    it('iniciar somente a partir de Pendente', () => {
        assert.equal(podeIniciarLimpeza(StatusEventoSuiteLimpeza.Pendente), true);
        assert.equal(podeIniciarLimpeza(StatusEventoSuiteLimpeza.EmAndamento), false);
        assert.equal(podeIniciarLimpeza(StatusEventoSuiteLimpeza.Concluida), false);
    });

    it('concluir somente a partir de EmAndamento', () => {
        assert.equal(podeConcluirLimpeza(StatusEventoSuiteLimpeza.EmAndamento), true);
        assert.equal(podeConcluirLimpeza(StatusEventoSuiteLimpeza.Pendente), false);
        assert.equal(podeConcluirLimpeza(StatusEventoSuiteLimpeza.Concluida), false);
    });
});
