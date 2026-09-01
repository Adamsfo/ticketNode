/**
 * Testes unitários — SuiteDisponibilidadeService (matriz v1.1 §8).
 * Runner: Node.js built-in `node:test` via ts-node.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromZonedTime } from 'date-fns-tz';
import {
    calcularDisponibilidadeSuite,
    calcularDisponibilidadePeriodo,
    classificarReservaNoDia,
    periodoConflitaComOcupantes,
    SUITE_DISPONIBILIDADE_TZ,
    type ReservaDisponibilidadeInput,
} from './suiteDisponibilidadeService';

/** Instante UTC a partir de parede Cuiabá. */
function cuiaba(ymd: string, hm: string): Date {
    const [y, m, d] = ymd.split('-').map(Number);
    const [hh, mm] = hm.split(':').map(Number);
    const wall = new Date(y, m - 1, d, hh, mm, 0, 0);
    return fromZonedTime(wall, SUITE_DISPONIBILIDADE_TZ);
}

function reserva(
    partial: Partial<ReservaDisponibilidadeInput> &
        Pick<ReservaDisponibilidadeInput, 'id' | 'status' | 'checkin' | 'checkout'>
): ReservaDisponibilidadeInput {
    return {
        saldoPendente: 0,
        ...partial,
    };
}

const HOJE_FIXO = '2026-07-27';

describe('SuiteDisponibilidadeService — regressão matriz §8', () => {
    it('R-09: sem reservas → Livre', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-28',
            hoje: HOJE_FIXO,
            reservas: [],
        });
        assert.equal(r.badge, 'LIVRE');
        assert.equal(r.livre, true);
        assert.equal(r.apareceEmSuitesLivres, true);
        assert.equal(r.podeReservar, true);
        assert.equal(r.agendaOcupada, false);
        assert.equal(r.reservaAtual, null);
    });

    it('R-01: CI 28 / CO 29 / D=28 Confirmada → Check-in hoje', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-28',
            hoje: '2026-07-28',
            reservas: [
                reserva({
                    id: 10,
                    status: 'Confirmada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'CHECKIN_HOJE');
        assert.equal(r.checkinHoje, true);
        assert.equal(r.checkoutHoje, false);
        assert.equal(r.apareceEmSuitesLivres, false);
        assert.equal(r.podeReservar, false);
        assert.equal(r.podeCheckin, true);
        assert.equal(r.podeCheckout, false);
        assert.equal(r.agendaOcupada, true);
    });

    it('R-01b: mesmo CI futuro (D=28, hoje=27) → badge Check-in hoje, sem botão', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-28',
            hoje: HOJE_FIXO,
            reservas: [
                reserva({
                    id: 10,
                    status: 'Confirmada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'CHECKIN_HOJE');
        assert.equal(r.podeCheckin, false);
        assert.equal(r.botaoPrincipal, 'ver_reserva');
    });

    it('R-02 / auditoria 28→29: D=29 Confirmada → Checkout hoje (não Check-in)', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-29',
            hoje: HOJE_FIXO,
            reservas: [
                reserva({
                    id: 10,
                    status: 'Confirmada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'CHECKOUT_HOJE');
        assert.equal(r.checkoutHoje, true);
        assert.equal(r.checkinHoje, false);
        assert.equal(r.disponivelAposCheckout, true);
        assert.equal(r.apareceEmSuitesLivres, true);
        assert.equal(r.podeReservar, true);
        assert.equal(r.podeCheckin, false);
        assert.equal(r.podeCheckout, false);
    });

    it('R-03: CI 28 / CO 29 / D=30 → Livre', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-30',
            hoje: HOJE_FIXO,
            reservas: [
                reserva({
                    id: 10,
                    status: 'Confirmada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'LIVRE');
        assert.equal(r.podeReservar, true);
        assert.equal(r.proximaReserva, null);
    });

    it('R-04: D=28 Hospedada → Hospedada + pode checkout', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-28',
            hoje: '2026-07-28',
            reservas: [
                reserva({
                    id: 10,
                    status: 'Hospedada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                    dataHoraCheckinReal: cuiaba('2026-07-28', '15:40'),
                }),
            ],
        });
        assert.equal(r.badge, 'HOSPEDADA');
        assert.equal(r.hospedada, true);
        assert.equal(r.podeCheckout, true);
        assert.equal(r.podeCheckin, false);
        assert.equal(r.podeReservar, false);
    });

    it('R-05: D=29 Hospedada → Checkout hoje + pode checkout', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-29',
            hoje: '2026-07-29',
            reservas: [
                reserva({
                    id: 10,
                    status: 'Hospedada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'CHECKOUT_HOJE');
        assert.equal(r.disponivelAposCheckout, true);
        assert.equal(r.podeCheckout, true);
        assert.equal(r.podeReservar, true);
    });

    it('R-06: CO hoje sem nova entrada → disp. após checkout', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-29',
            hoje: '2026-07-29',
            reservas: [
                reserva({
                    id: 10,
                    status: 'Confirmada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'CHECKOUT_HOJE');
        assert.equal(r.disponivelAposCheckout, true);
        assert.equal(r.possuiCheckinNaData, false);
        assert.equal(r.apareceEmSuitesLivres, true);
        assert.equal(r.podeReservar, true);
    });

    it('R-07: CO hoje + nova entrada hoje → Checkout hoje, NÃO livre', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-29',
            hoje: '2026-07-29',
            reservas: [
                reserva({
                    id: 10,
                    status: 'Hospedada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                }),
                reserva({
                    id: 11,
                    status: 'Confirmada',
                    checkin: cuiaba('2026-07-29', '16:00'),
                    checkout: cuiaba('2026-07-30', '13:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'CHECKOUT_HOJE');
        assert.equal(r.checkinHoje, false);
        assert.equal(r.possuiCheckinNaData, true);
        assert.equal(r.disponivelAposCheckout, false);
        assert.equal(r.apareceEmSuitesLivres, false);
        assert.equal(r.podeReservar, false);
        assert.equal(r.reservaAtual?.id, 10);
        assert.equal(r.reservaEntradaNaData?.id, 11);
        assert.equal(r.mensagemSecundaria, null);
    });

    it('R-07b: CO + entrada — metadados da próxima reserva no retorno', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-29',
            hoje: '2026-07-29',
            reservas: [
                reserva({
                    id: 10,
                    status: 'Hospedada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                    responsavelNome: 'Hóspede Atual',
                }),
                reserva({
                    id: 11,
                    status: 'Confirmada',
                    checkin: cuiaba('2026-07-29', '16:00'),
                    checkout: cuiaba('2026-07-30', '13:00'),
                    responsavelNome: 'Lilian',
                    origemReserva: 'BOOKING',
                }),
            ],
        });
        assert.equal(r.reservaEntradaNaData?.responsavelNome, 'Lilian');
        assert.equal(r.reservaEntradaNaData?.origemReserva, 'BOOKING');
    });

    it('R-08: reserva futura no dia D (sem overlap) → Livre + proximaReserva', () => {
        const futura = reserva({
            id: 20,
            status: 'Confirmada',
            checkin: cuiaba('2026-08-10', '16:00'),
            checkout: cuiaba('2026-08-11', '13:00'),
        });
        const dia = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-28',
            hoje: HOJE_FIXO,
            reservas: [futura],
        });
        assert.equal(dia.badge, 'LIVRE');
        assert.equal(dia.proximaReserva?.id, 20);
        assert.equal(dia.agendaOcupada, false);
        assert.equal(dia.podeReservar, true);
        assert.equal(dia.apareceEmSuitesLivres, true);
    });

    it('R-08b: classificarReservaNoDia antes do CI → Reservada (não ocupa agenda)', () => {
        const futura = reserva({
            id: 20,
            status: 'Confirmada',
            checkin: cuiaba('2026-08-10', '16:00'),
            checkout: cuiaba('2026-08-11', '13:00'),
        });
        const isolada = classificarReservaNoDia(futura, '2026-07-28');
        assert.equal(isolada.badge, 'RESERVADA');
        assert.equal(isolada.relacao, 'antes_checkin');
        assert.equal(isolada.agendaOcupada, false);
    });

    it('R-10: noite intermediária Confirmada → Reservada (não Check-in hoje)', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-29',
            hoje: HOJE_FIXO,
            reservas: [
                reserva({
                    id: 10,
                    status: 'Confirmada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-31', '13:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'RESERVADA');
        assert.equal(r.checkinHoje, false);
        assert.equal(r.podeReservar, false);
        assert.equal(r.agendaOcupada, true);
        assert.equal(r.podeCheckin, false); // D agenda futuro (> hoje)
    });

    it('R-10b: noite intermediária Confirmada no dia atual → Reservada + check-in atrasado (§7)', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-29',
            hoje: '2026-07-29',
            reservas: [
                reserva({
                    id: 10,
                    status: 'Confirmada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-31', '13:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'RESERVADA');
        assert.equal(r.podeCheckin, true);
        assert.equal(r.botaoPrincipal, 'checkin');
    });

    it('R-11: checkout operacional já feito no dia do CO → Livre', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-29',
            hoje: HOJE_FIXO,
            reservas: [
                reserva({
                    id: 10,
                    status: 'CheckOutRealizado',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                    dataHoraCheckoutRealizado: cuiaba('2026-07-29', '12:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'LIVRE');
        assert.equal(r.podeReservar, true);
    });

    it('R-12: Aguardando pagamento cobrindo D', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-28',
            hoje: HOJE_FIXO,
            reservas: [
                reserva({
                    id: 10,
                    status: 'AguardandoPagamento',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'AGUARDANDO_PAGAMENTO');
        assert.equal(r.podeReservar, false);
        assert.equal(r.podeCheckin, false);
    });

    it('R-13: Cancelada / Expirada → Livre', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-28',
            hoje: HOJE_FIXO,
            reservas: [
                reserva({
                    id: 1,
                    status: 'Cancelada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                }),
                reserva({
                    id: 2,
                    status: 'Expirada',
                    checkin: cuiaba('2026-07-28', '10:00'),
                    checkout: cuiaba('2026-07-29', '10:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'LIVRE');
        assert.equal(r.podeReservar, true);
    });

    it('R-14: novo CI antes do CO existente → conflito', () => {
        const ocupantes = [
            reserva({
                id: 10,
                status: 'Confirmada',
                checkin: cuiaba('2026-07-28', '16:00'),
                checkout: cuiaba('2026-07-29', '13:00'),
            }),
        ];
        assert.equal(
            periodoConflitaComOcupantes(
                cuiaba('2026-07-29', '12:59'),
                cuiaba('2026-07-30', '13:00'),
                ocupantes
            ),
            true
        );
    });

    it('R-15: novo CI ≥ CO existente sem outra entrada → sem conflito', () => {
        const ocupantes = [
            reserva({
                id: 10,
                status: 'Confirmada',
                checkin: cuiaba('2026-07-28', '16:00'),
                checkout: cuiaba('2026-07-29', '13:00'),
            }),
        ];
        assert.equal(
            periodoConflitaComOcupantes(
                cuiaba('2026-07-29', '13:00'),
                cuiaba('2026-07-30', '13:00'),
                ocupantes
            ),
            false
        );
        assert.equal(
            periodoConflitaComOcupantes(
                cuiaba('2026-07-29', '14:00'),
                cuiaba('2026-07-30', '13:00'),
                ocupantes
            ),
            false
        );
    });

    it('múltiplas reservas futuras: proximaReserva = mais próxima', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-28',
            hoje: HOJE_FIXO,
            reservas: [
                reserva({
                    id: 2,
                    status: 'Confirmada',
                    checkin: cuiaba('2026-08-20', '16:00'),
                    checkout: cuiaba('2026-08-21', '13:00'),
                }),
                reserva({
                    id: 1,
                    status: 'Confirmada',
                    checkin: cuiaba('2026-08-05', '16:00'),
                    checkout: cuiaba('2026-08-06', '13:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'LIVRE');
        assert.equal(r.proximaReserva?.id, 1);
    });

    it('check-in bloqueado com saldo pendente', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-28',
            hoje: '2026-07-28',
            reservas: [
                reserva({
                    id: 10,
                    status: 'Confirmada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                    saldoPendente: 100,
                }),
            ],
        });
        assert.equal(r.badge, 'CHECKIN_HOJE');
        assert.equal(r.podeCheckin, false);
    });

    it('Confirmada no dia do CO sem entrada → check-in pelo ciclo de vida', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-29',
            hoje: '2026-07-29',
            reservas: [
                reserva({
                    id: 10,
                    status: 'Confirmada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'CHECKOUT_HOJE');
        assert.equal(r.podeCheckin, true);
        assert.equal(r.podeCheckout, false);
    });

    it('Check-in em dia passado da agenda (retroativo) com Confirmada', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-28',
            hoje: '2026-07-30',
            reservas: [
                reserva({
                    id: 10,
                    status: 'Confirmada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                }),
            ],
        });
        assert.equal(r.badge, 'CHECKIN_HOJE');
        assert.equal(r.podeCheckin, true);
        assert.equal(r.podeCheckout, false);
    });

    it('Hospedada em dia passado da agenda → pode check-out', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-28',
            hoje: '2026-07-30',
            reservas: [
                reserva({
                    id: 10,
                    status: 'Hospedada',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                    dataHoraCheckinReal: cuiaba('2026-07-28', '16:10'),
                }),
            ],
        });
        assert.equal(r.badge, 'HOSPEDADA');
        assert.equal(r.podeCheckin, false);
        assert.equal(r.podeCheckout, true);
    });

    it('CheckOutRealizado → sem check-in/out', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-29',
            hoje: '2026-07-29',
            reservas: [
                reserva({
                    id: 10,
                    status: 'CheckOutRealizado',
                    checkin: cuiaba('2026-07-28', '16:00'),
                    checkout: cuiaba('2026-07-29', '13:00'),
                    dataHoraCheckinReal: cuiaba('2026-07-28', '16:10'),
                    dataHoraCheckoutRealizado: cuiaba('2026-07-29', '11:00'),
                }),
            ],
        });
        assert.equal(r.podeCheckin, false);
        assert.equal(r.podeCheckout, false);
    });

    it('data passada: consulta histórica sem Nova Reserva', () => {
        const r = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-20',
            hoje: HOJE_FIXO,
            reservas: [],
        });
        assert.equal(r.badge, 'LIVRE');
        assert.equal(r.podeReservar, false);
        assert.equal(r.mensagem, 'Consulta histórica');
    });
});

describe('calcularDisponibilidadePeriodo — Nova Reserva alinhada aos cards', () => {
    const ocupante28a29 = () =>
        reserva({
            id: 10,
            status: 'Confirmada',
            checkin: cuiaba('2026-07-28', '16:00'),
            checkout: cuiaba('2026-07-29', '13:00'),
        });

    it('suíte livre → podeReservar (período futuro)', () => {
        const disp = calcularDisponibilidadePeriodo({
            idEventoSuite: 1,
            checkin: cuiaba('2026-07-28', '16:00'),
            checkout: cuiaba('2026-07-29', '13:00'),
            hoje: HOJE_FIXO,
            reservas: [],
        });
        assert.equal(disp.podeReservar, true);
        assert.equal(disp.disponibilidadeNoDiaCheckin.podeReservar, true);
    });

    it('28→29 Confirmada: CI 28 → não lista (check-in hoje no card)', () => {
        const card = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-28',
            hoje: HOJE_FIXO,
            reservas: [ocupante28a29()],
        });
        const periodo = calcularDisponibilidadePeriodo({
            idEventoSuite: 1,
            checkin: cuiaba('2026-07-28', '18:00'),
            checkout: cuiaba('2026-07-29', '13:00'),
            hoje: HOJE_FIXO,
            reservas: [ocupante28a29()],
        });
        assert.equal(card.podeReservar, false);
        assert.equal(periodo.podeReservar, false);
        assert.equal(periodo.podeReservar, card.podeReservar);
    });

    it('28→29 Confirmada: CI 29 16:00 após CO 13:00 → lista (igual card dia 29)', () => {
        const card = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-29',
            hoje: HOJE_FIXO,
            reservas: [ocupante28a29()],
        });
        const periodo = calcularDisponibilidadePeriodo({
            idEventoSuite: 1,
            checkin: cuiaba('2026-07-29', '16:00'),
            checkout: cuiaba('2026-07-30', '13:00'),
            hoje: HOJE_FIXO,
            reservas: [ocupante28a29()],
        });
        assert.equal(card.podeReservar, true);
        assert.equal(periodo.conflitoPeriodo, false);
        assert.equal(periodo.podeReservar, true);
    });

    it('28→29: CI 29 10:30 antes do CO → não lista (horário personalizado)', () => {
        const periodo = calcularDisponibilidadePeriodo({
            idEventoSuite: 1,
            checkin: cuiaba('2026-07-29', '10:30'),
            checkout: cuiaba('2026-07-30', '13:00'),
            hoje: HOJE_FIXO,
            reservas: [ocupante28a29()],
        });
        assert.equal(periodo.conflitoPeriodo, true);
        assert.equal(periodo.podeReservar, false);
    });

    it('CO hoje + nova entrada no mesmo dia → não lista', () => {
        const reservas = [
            reserva({
                id: 10,
                status: 'Hospedada',
                checkin: cuiaba('2026-07-28', '16:00'),
                checkout: cuiaba('2026-07-29', '13:00'),
            }),
            reserva({
                id: 11,
                status: 'Confirmada',
                checkin: cuiaba('2026-07-29', '16:00'),
                checkout: cuiaba('2026-07-30', '13:00'),
            }),
        ];
        const card = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-29',
            hoje: '2026-07-29',
            reservas,
        });
        const periodo = calcularDisponibilidadePeriodo({
            idEventoSuite: 1,
            checkin: cuiaba('2026-07-29', '17:00'),
            checkout: cuiaba('2026-07-30', '13:00'),
            hoje: '2026-07-29',
            reservas,
        });
        assert.equal(card.podeReservar, false);
        assert.equal(periodo.podeReservar, false);
    });

    it('hospedada noite intermediária → não lista', () => {
        const reservas = [
            reserva({
                id: 10,
                status: 'Hospedada',
                checkin: cuiaba('2026-07-28', '16:00'),
                checkout: cuiaba('2026-07-31', '13:00'),
            }),
        ];
        const card = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-29',
            hoje: HOJE_FIXO,
            reservas,
        });
        const periodo = calcularDisponibilidadePeriodo({
            idEventoSuite: 1,
            checkin: cuiaba('2026-07-29', '16:00'),
            checkout: cuiaba('2026-07-30', '13:00'),
            hoje: HOJE_FIXO,
            reservas,
        });
        assert.equal(card.badge, 'HOSPEDADA');
        assert.equal(card.podeReservar, false);
        assert.equal(periodo.podeReservar, false);
    });

    it('reserva futura: dia livre antes do CI → lista se período não cruza', () => {
        const reservas = [
            reserva({
                id: 20,
                status: 'Confirmada',
                checkin: cuiaba('2026-08-10', '16:00'),
                checkout: cuiaba('2026-08-11', '13:00'),
            }),
        ];
        const card = calcularDisponibilidadeSuite({
            idEventoSuite: 1,
            dataSelecionada: '2026-07-28',
            hoje: HOJE_FIXO,
            reservas,
        });
        const periodo = calcularDisponibilidadePeriodo({
            idEventoSuite: 1,
            checkin: cuiaba('2026-07-28', '16:00'),
            checkout: cuiaba('2026-07-29', '13:00'),
            hoje: HOJE_FIXO,
            reservas,
        });
        assert.equal(card.podeReservar, true);
        assert.equal(periodo.podeReservar, true);
    });
});
