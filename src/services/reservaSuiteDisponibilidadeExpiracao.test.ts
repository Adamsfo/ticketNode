import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcularDisponibilidadePeriodo } from './suiteDisponibilidadeService';
import { estaReservaHospedagemAguardandoPagamentoVencida } from './reservaHospedagemExpiracaoUtils';

/**
 * Espelha o filtro de `carregarReservasParaDisponibilidade` (reserva vencida não entra).
 */
function reservasParaDisponibilidade(
    candidatas: Array<{
        id: number;
        status: string;
        checkin: Date;
        checkout: Date;
        origemReserva?: string;
        createdAt?: Date;
        tokenPagamento?: string | null;
        expiraEm?: Date | null;
    }>,
    referencia: Date = new Date()
) {
    return candidatas
        .filter(
            (r) => !estaReservaHospedagemAguardandoPagamentoVencida(r, referencia)
        )
        .map((r) => ({
            id: r.id,
            status: r.status as 'AguardandoPagamento',
            checkin: r.checkin,
            checkout: r.checkout,
            saldoPendente: 0,
        }));
}

describe('disponibilidade — reserva vencida não ocupa', () => {
    const checkin = new Date('2026-08-01T19:00:00.000Z');
    const checkout = new Date('2026-08-03T11:00:00.000Z');
    const agora = new Date('2026-09-21T12:00:00.000Z');

    it('reserva AguardandoPagamento válida continua bloqueando (conflito de período)', () => {
        const reservas = reservasParaDisponibilidade([
            {
                id: 1,
                status: 'Confirmada',
                checkin,
                checkout,
            },
        ]);
        const disp = calcularDisponibilidadePeriodo({
            idEventoSuite: 10,
            checkin,
            checkout,
            reservas: reservas.map((r) => ({
                ...r,
                status: 'Confirmada' as const,
            })),
        });
        assert.equal(disp.conflitoPeriodo, true);
    });

    it('reserva CLIENTE vencida não bloqueia', () => {
        const reservas = reservasParaDisponibilidade([
            {
                id: 2,
                status: 'AguardandoPagamento',
                checkin,
                checkout,
                origemReserva: 'CLIENTE',
                createdAt: new Date(agora.getTime() - 20 * 60 * 1000),
            },
        ], agora);
        assert.equal(reservas.length, 0);
        const disp = calcularDisponibilidadePeriodo({
            idEventoSuite: 10,
            checkin,
            checkout,
            reservas,
        });
        assert.equal(disp.conflitoPeriodo, false);
    });

    it('AguardandoPagamento ainda dentro do prazo continua na lista de ocupantes', () => {
        const createdAt = new Date(agora.getTime() - 5 * 60 * 1000);
        const candidata = {
            id: 4,
            status: 'AguardandoPagamento',
            checkin,
            checkout,
            origemReserva: 'CLIENTE',
            createdAt,
        };
        assert.equal(
            estaReservaHospedagemAguardandoPagamentoVencida(candidata, agora),
            false
        );
        const reservas = reservasParaDisponibilidade([candidata], agora);
        assert.equal(reservas.length, 1);
    });
});
