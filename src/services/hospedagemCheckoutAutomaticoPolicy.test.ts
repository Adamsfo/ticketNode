import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StatusReservaHospedagem } from '../models/ReservaHospedagem';
import { VendaJangoStatus } from '../api/hospedagemVendaJangoReadService';
import {
    avaliarStatusVendaCheckoutAutomatico,
    calcularLimiteCheckoutComMargem,
    idVendaJangoValido,
    MARGEM_SEGURANCA_CHECKOUT_AUTOMATICO_MS,
    mapearMotivoConsultaPdv,
    reservaElegivelCheckoutAutomatico,
} from './hospedagemCheckoutAutomaticoPolicy';

describe('hospedagemCheckoutAutomaticoPolicy', () => {
    it('reserva elegível — Hospedada, checkout vencido com margem, idVendaJango válido', () => {
        const agora = new Date('2026-09-21T06:00:00.000Z');
        const checkout = new Date(
            agora.getTime() - MARGEM_SEGURANCA_CHECKOUT_AUTOMATICO_MS - 60_000
        );

        assert.equal(
            reservaElegivelCheckoutAutomatico({
                status: StatusReservaHospedagem.Hospedada,
                checkout,
                idVendaJango: 55289,
                agora,
            }),
            true
        );
    });

    it('reserva não elegível — dentro da margem de 30 minutos', () => {
        const agora = new Date('2026-09-21T06:00:00.000Z');
        const checkout = new Date(
            agora.getTime() - MARGEM_SEGURANCA_CHECKOUT_AUTOMATICO_MS + 60_000
        );

        assert.equal(
            reservaElegivelCheckoutAutomatico({
                status: StatusReservaHospedagem.Hospedada,
                checkout,
                idVendaJango: 55289,
                agora,
            }),
            false
        );
    });

    it('reserva não elegível — status diferente de Hospedada', () => {
        assert.equal(
            reservaElegivelCheckoutAutomatico({
                status: StatusReservaHospedagem.Confirmada,
                checkout: new Date('2026-09-19T00:00:00.000Z'),
                idVendaJango: 1,
            }),
            false
        );
    });

    it('conta aberta (STATUS 0) não executa checkout', () => {
        const r = avaliarStatusVendaCheckoutAutomatico(VendaJangoStatus.Aberto);
        assert.equal(r.executarCheckout, false);
        assert.equal(r.acao, 'IGNORAR_CONTA_ABERTA');
    });

    it('conta fechada (STATUS 1) executa checkout', () => {
        const r = avaliarStatusVendaCheckoutAutomatico(VendaJangoStatus.Fechado);
        assert.equal(r.executarCheckout, true);
        assert.equal(r.acao, 'EXECUTAR_CHECKOUT');
    });

    it('conta cancelada (STATUS 2) não executa checkout', () => {
        const r = avaliarStatusVendaCheckoutAutomatico(
            VendaJangoStatus.Cancelado
        );
        assert.equal(r.executarCheckout, false);
        assert.equal(r.acao, 'IGNORAR_VENDA_CANCELADA');
    });

    it('STATUS 3/4 não executa checkout', () => {
        assert.equal(
            avaliarStatusVendaCheckoutAutomatico(VendaJangoStatus.Reservado)
                .executarCheckout,
            false
        );
        assert.equal(
            avaliarStatusVendaCheckoutAutomatico(VendaJangoStatus.Agenda)
                .executarCheckout,
            false
        );
    });

    it('mapear motivo consulta PDV', () => {
        assert.equal(
            mapearMotivoConsultaPdv('NAO_ENCONTRADA'),
            'IGNORAR_VENDA_INEXISTENTE'
        );
        assert.equal(
            mapearMotivoConsultaPdv('ERRO_COMUNICACAO'),
            'IGNORAR_ERRO_PDV'
        );
    });

    it('calcularLimiteCheckoutComMargem subtrai 30 minutos', () => {
        const agora = new Date('2026-09-21T06:00:00.000Z');
        const limite = calcularLimiteCheckoutComMargem(agora);
        assert.equal(
            limite.getTime(),
            agora.getTime() - MARGEM_SEGURANCA_CHECKOUT_AUTOMATICO_MS
        );
    });

    it('idVendaJangoValido', () => {
        assert.equal(idVendaJangoValido(10), true);
        assert.equal(idVendaJangoValido(0), false);
        assert.equal(idVendaJangoValido(null), false);
    });
});
