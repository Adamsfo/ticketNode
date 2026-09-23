import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizarVendaHospedagemJango } from './hospedagemVendaJangoReadService';

describe('normalizarVendaHospedagemJango', () => {
    it('normaliza campos em maiúsculas do Firebird', () => {
        const venda = normalizarVendaHospedagemJango({
            ID_VENDA: 55289,
            STATUS: 1,
            DATA_HORA: '2026-09-19 14:00:00',
            ID_CLIENTE: 1234,
            TOTAL_VENDA: 670,
            VALOR_RECEBIDO: 670,
            VALOR_A_RECEBER: 0,
            SUITE: 'SIM',
        });

        assert.equal(venda.idVenda, 55289);
        assert.equal(venda.status, 1);
        assert.equal(venda.idCliente, 1234);
        assert.equal(venda.totalVenda, 670);
        assert.equal(venda.suite, 'SIM');
    });
});
