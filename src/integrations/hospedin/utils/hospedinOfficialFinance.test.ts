/**
 * Testes — conversão financeiro Hospedin (centavos) → oficial Jango.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractHospedinOfficialFinance } from '../utils/hospedinOfficialFinance';

describe('extractHospedinOfficialFinance', () => {
    it('converte centavos para reais (total / pago / saldo)', () => {
        const r = extractHospedinOfficialFinance({
            total_amount: 47500,
            total_received: 47500,
            total_to_receive: 0,
        });
        assert.ok(r);
        assert.equal(r!.valorTotal, 475);
        assert.equal(r!.valorPago, 475);
        assert.equal(r!.saldoPendente, 0);
    });

    it('saldo pendente a partir de to_receive', () => {
        const r = extractHospedinOfficialFinance({
            total_amount: 50000,
            total_received: 25000,
            total_to_receive: 25000,
        });
        assert.ok(r);
        assert.equal(r!.valorTotal, 500);
        assert.equal(r!.valorPago, 250);
        assert.equal(r!.saldoPendente, 250);
    });

    it('sem total_amount → null', () => {
        assert.equal(extractHospedinOfficialFinance({}), null);
    });
});
