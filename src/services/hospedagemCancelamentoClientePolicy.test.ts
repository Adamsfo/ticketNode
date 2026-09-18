/**
 * node --require ts-node/register/transpile-only --test \
 *   src/services/hospedagemCancelamentoClientePolicy.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StatusReservaHospedagem } from '../models/ReservaHospedagem';
import { FormaPagamentoRecepcaoValor } from '../models/PagamentoHospedagem';
import {
    avaliarElegibilidadeCancelamentoCliente,
    calcularHorasRestantesCheckin,
    calcularPoliticaDevolucaoCliente,
    distribuirEstornoMercadoPago,
    isOrigemCancelamentoClientePermitida,
} from './hospedagemCancelamentoClientePolicy';

const checkinBase = new Date('2026-10-10T19:00:00.000Z');

describe('isOrigemCancelamentoClientePermitida', () => {
    it('permite CLIENTE e SITE', () => {
        assert.equal(
            isOrigemCancelamentoClientePermitida({ origemReserva: 'CLIENTE' }),
            true
        );
        assert.equal(
            isOrigemCancelamentoClientePermitida({ origemReserva: 'SITE' }),
            true
        );
    });

    it('permite link externo via tokenPagamento', () => {
        assert.equal(
            isOrigemCancelamentoClientePermitida({
                origemReserva: 'ATENDENTE',
                tokenPagamento: 'abc123',
            }),
            true
        );
    });

    it('bloqueia atendente sem link', () => {
        assert.equal(
            isOrigemCancelamentoClientePermitida({ origemReserva: 'ATENDENTE' }),
            false
        );
    });

    it('bloqueia Booking, Airbnb e Hospedin', () => {
        assert.equal(
            isOrigemCancelamentoClientePermitida({ origemReserva: 'BOOKING' }),
            false
        );
        assert.equal(
            isOrigemCancelamentoClientePermitida({ origemReserva: 'AIRBNB' }),
            false
        );
        assert.equal(
            isOrigemCancelamentoClientePermitida({ origemReserva: 'HOSPEDIN' }),
            false
        );
    });
});

describe('calcularPoliticaDevolucaoCliente', () => {
    it('72h + 1 minuto → 100%', () => {
        const agora = new Date(checkinBase.getTime() - (72 * 60 + 1) * 60 * 1000);
        const politica = calcularPoliticaDevolucaoCliente({
            checkin: checkinBase,
            valorPago: 1000,
            agora,
        });
        assert.equal(politica.percentualDevolucao, 100);
        assert.equal(politica.valorDevolucao, 1000);
    });

    it('exatamente 72h → 50%', () => {
        const agora = new Date(checkinBase.getTime() - 72 * 60 * 60 * 1000);
        const politica = calcularPoliticaDevolucaoCliente({
            checkin: checkinBase,
            valorPago: 1000,
            agora,
        });
        assert.equal(politica.percentualDevolucao, 50);
        assert.equal(politica.valorDevolucao, 500);
    });

    it('71h59 → 50%', () => {
        const agora = new Date(checkinBase.getTime() - (72 * 60 - 1) * 60 * 1000);
        const politica = calcularPoliticaDevolucaoCliente({
            checkin: checkinBase,
            valorPago: 800,
            agora,
        });
        assert.equal(politica.percentualDevolucao, 50);
        assert.equal(politica.valorDevolucao, 400);
    });
});

describe('avaliarElegibilidadeCancelamentoCliente', () => {
    const reservaBase = {
        status: StatusReservaHospedagem.Confirmada,
        origemReserva: 'CLIENTE',
        tokenPagamento: null,
        checkin: checkinBase,
        valorPago: 1000,
    };

    it('Confirmada + CLIENTE + MP integral → pode cancelar', () => {
        const agora = new Date(checkinBase.getTime() - 5 * 24 * 60 * 60 * 1000);
        const elegivel = avaliarElegibilidadeCancelamentoCliente({
            reserva: reservaBase,
            pagamentos: [
                {
                    id: 1,
                    valor: 1000,
                    formaPagamento: FormaPagamentoRecepcaoValor.PIX,
                    comprovante: '12345678901',
                },
            ],
            agora,
        });
        assert.equal(elegivel.podeCancelar, true);
        assert.equal(elegivel.percentualDevolucao, 100);
        assert.equal(elegivel.valorDevolucao, 1000);
    });

    it('Hospedada → bloqueia', () => {
        const elegivel = avaliarElegibilidadeCancelamentoCliente({
            reserva: {
                ...reservaBase,
                status: StatusReservaHospedagem.Hospedada,
            },
            pagamentos: [],
        });
        assert.equal(elegivel.podeCancelar, false);
    });

    it('ATENDENTE sem link → bloqueia', () => {
        const elegivel = avaliarElegibilidadeCancelamentoCliente({
            reserva: {
                ...reservaBase,
                origemReserva: 'ATENDENTE',
            },
            pagamentos: [
                {
                    id: 1,
                    valor: 1000,
                    formaPagamento: FormaPagamentoRecepcaoValor.PIX,
                    comprovante: '12345678901',
                },
            ],
        });
        assert.equal(elegivel.podeCancelar, false);
    });

    it('pagamento manual impede cancelamento automático', () => {
        const elegivel = avaliarElegibilidadeCancelamentoCliente({
            reserva: reservaBase,
            pagamentos: [
                {
                    id: 1,
                    valor: 500,
                    formaPagamento: FormaPagamentoRecepcaoValor.Dinheiro,
                    comprovante: null,
                },
                {
                    id: 2,
                    valor: 500,
                    formaPagamento: FormaPagamentoRecepcaoValor.PIX,
                    comprovante: '12345678901',
                },
            ],
        });
        assert.equal(elegivel.podeCancelar, false);
        assert.equal(elegivel.requerEstornoManual, true);
    });
});

describe('distribuirEstornoMercadoPago', () => {
    it('distribui entre múltiplos pagamentos MP sem ultrapassar', () => {
        const distribuicao = distribuirEstornoMercadoPago(
            [
                {
                    id: 1,
                    valor: 300,
                    formaPagamento: FormaPagamentoRecepcaoValor.PIX,
                    comprovante: '11111111111',
                },
                {
                    id: 2,
                    valor: 700,
                    formaPagamento: FormaPagamentoRecepcaoValor.PIX,
                    comprovante: '22222222222',
                },
            ],
            500
        );
        assert.deepEqual(distribuicao, [
            {
                idPagamentoHospedagem: 1,
                paymentId: '11111111111',
                amount: 300,
            },
            {
                idPagamentoHospedagem: 2,
                paymentId: '22222222222',
                amount: 200,
            },
        ]);
    });
});

describe('calcularHorasRestantesCheckin', () => {
    it('calcula horas restantes com base no servidor', () => {
        const agora = new Date('2026-10-08T19:00:00.000Z');
        const horas = calcularHorasRestantesCheckin(checkinBase, agora);
        assert.equal(horas, 48);
    });
});
