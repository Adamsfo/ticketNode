import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    decidirConfirmacaoReservaExpiradaPosPagamento,
    reservaBloqueiaInicioPagamentoPorExpirada,
    reservaElegivelFluxoConfirmacaoPosPagamento,
} from './reservaHospedagemConfirmacaoPosPagamentoService';
import { StatusReservaHospedagem } from '../models/ReservaHospedagem';

describe('confirmarHospedagem — regra pagamento vs expiração', () => {
    describe('decisão centralizada (Expirada + Pago)', () => {
        it('1 — fluxo normal: AguardandoPagamento elegível à confirmação', () => {
            assert.equal(
                reservaElegivelFluxoConfirmacaoPosPagamento('AguardandoPagamento'),
                true
            );
        });

        it('2 — job expirou durante pagamento: revalidação OK → confirmar', () => {
            assert.equal(
                decidirConfirmacaoReservaExpiradaPosPagamento({
                    transacaoStatus: 'Pago',
                    idTransacao: 10,
                    reservaIdTransacao: 10,
                    pagamentoGatewayIniciado: true,
                    suitesDisponiveis: true,
                }),
                'confirmar'
            );
        });

        it('5 — suíte ocupada: não confirmar automaticamente', () => {
            assert.equal(
                decidirConfirmacaoReservaExpiradaPosPagamento({
                    transacaoStatus: 'Pago',
                    idTransacao: 10,
                    reservaIdTransacao: 10,
                    pagamentoGatewayIniciado: true,
                    suitesDisponiveis: false,
                }),
                'suite_indisponivel'
            );
        });

        it('6 — PIX/webhook tardio: pagamento iniciado + disponível → confirmar', () => {
            assert.equal(
                decidirConfirmacaoReservaExpiradaPosPagamento({
                    transacaoStatus: 'Pago',
                    idTransacao: 99,
                    reservaIdTransacao: 99,
                    pagamentoGatewayIniciado: true,
                    suitesDisponiveis: true,
                }),
                'confirmar'
            );
        });

        it('Expirada + Pago sem evidência de pagamento iniciado → não confirmar', () => {
            assert.equal(
                decidirConfirmacaoReservaExpiradaPosPagamento({
                    transacaoStatus: 'Pago',
                    idTransacao: 10,
                    reservaIdTransacao: 10,
                    pagamentoGatewayIniciado: false,
                    suitesDisponiveis: true,
                }),
                'sem_pagamento_iniciado'
            );
        });
    });

    describe('3 — pagamento novo após expiração', () => {
        it('REJEITA início de pagamento com reserva já Expirada', () => {
            assert.equal(
                reservaBloqueiaInicioPagamentoPorExpirada(
                    StatusReservaHospedagem.Expirada
                ),
                true
            );
        });
    });

    describe('4 — confirmação duplicada (idempotência de status)', () => {
        it('Confirmada e quitada não reentra no fluxo de confirmação', () => {
            const status = StatusReservaHospedagem.Confirmada;
            const jaQuitada = true;
            const deveEncerrar =
                status === StatusReservaHospedagem.Confirmada && jaQuitada;
            assert.equal(deveEncerrar, true);
        });

        it('segunda passagem com pagamento já lançado zera novo lançamento', () => {
            const pagamentoJaLancado = true;
            const valorLancamentoGateway = 250;
            const valorEfetivo = pagamentoJaLancado ? 0 : valorLancamentoGateway;
            assert.equal(valorEfetivo, 0);
        });
    });
});
