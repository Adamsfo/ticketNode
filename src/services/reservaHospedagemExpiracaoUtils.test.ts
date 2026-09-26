import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    MINUTOS_EXPIRACAO_LINK_PAGAMENTO,
    MINUTOS_EXPIRACAO_RESERVA_ONLINE,
    estaReservaHospedagemAguardandoPagamentoVencida,
} from './reservaHospedagemExpiracaoUtils';

describe('estaReservaHospedagemAguardandoPagamentoVencida', () => {
    const agora = new Date('2026-09-21T12:00:00.000Z');

    it('Confirmada não é tratada como vencida', () => {
        assert.equal(
            estaReservaHospedagemAguardandoPagamentoVencida(
                {
                    status: 'Confirmada',
                    createdAt: new Date('2020-01-01'),
                },
                agora
            ),
            false
        );
    });

    it('CLIENTE dentro de 15 minutos não está vencida', () => {
        const createdAt = new Date(
            agora.getTime() - (MINUTOS_EXPIRACAO_RESERVA_ONLINE - 1) * 60 * 1000
        );
        assert.equal(
            estaReservaHospedagemAguardandoPagamentoVencida(
                {
                    status: 'AguardandoPagamento',
                    origemReserva: 'CLIENTE',
                    createdAt,
                },
                agora
            ),
            false
        );
    });

    it('CLIENTE após 15 minutos está vencida', () => {
        const createdAt = new Date(
            agora.getTime() - (MINUTOS_EXPIRACAO_RESERVA_ONLINE + 1) * 60 * 1000
        );
        assert.equal(
            estaReservaHospedagemAguardandoPagamentoVencida(
                {
                    status: 'AguardandoPagamento',
                    origemReserva: 'CLIENTE',
                    createdAt,
                },
                agora
            ),
            true
        );
    });

    it('SITE legado usa mesma regra de 15 minutos', () => {
        const createdAt = new Date(
            agora.getTime() - (MINUTOS_EXPIRACAO_RESERVA_ONLINE + 5) * 60 * 1000
        );
        assert.equal(
            estaReservaHospedagemAguardandoPagamentoVencida(
                {
                    status: 'AguardandoPagamento',
                    origemReserva: 'SITE',
                    createdAt,
                },
                agora
            ),
            true
        );
    });

    it('link com token dentro de 30 minutos não está vencida', () => {
        const createdAt = new Date(
            agora.getTime() -
                (MINUTOS_EXPIRACAO_LINK_PAGAMENTO - 2) * 60 * 1000
        );
        assert.equal(
            estaReservaHospedagemAguardandoPagamentoVencida(
                {
                    status: 'AguardandoPagamento',
                    origemReserva: 'ATENDENTE',
                    tokenPagamento: 'abc123',
                    createdAt,
                },
                agora
            ),
            false
        );
    });

    it('link com token após 30 minutos está vencida', () => {
        const createdAt = new Date(
            agora.getTime() -
                (MINUTOS_EXPIRACAO_LINK_PAGAMENTO + 1) * 60 * 1000
        );
        assert.equal(
            estaReservaHospedagemAguardandoPagamentoVencida(
                {
                    status: 'AguardandoPagamento',
                    tokenPagamento: 'abc123',
                    createdAt,
                },
                agora
            ),
            true
        );
    });

    it('expiraEm explícito no passado está vencida', () => {
        assert.equal(
            estaReservaHospedagemAguardandoPagamentoVencida(
                {
                    status: 'AguardandoPagamento',
                    expiraEm: new Date('2026-09-21T11:00:00.000Z'),
                    createdAt: agora,
                },
                agora
            ),
            true
        );
    });

    it('expiraEm explícito no futuro não está vencida', () => {
        assert.equal(
            estaReservaHospedagemAguardandoPagamentoVencida(
                {
                    status: 'AguardandoPagamento',
                    expiraEm: new Date('2026-09-21T13:00:00.000Z'),
                    origemReserva: 'CLIENTE',
                    createdAt: new Date('2020-01-01'),
                },
                agora
            ),
            false
        );
    });
});
