/**
 * node --require ts-node/register/transpile-only --test \
 *   src/services/hospedagemRemarcacaoClientePolicy.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StatusReservaHospedagem } from '../models/ReservaHospedagem';
import {
    avaliarElegibilidadeRemarcacaoCliente,
    calcularSaldoAposTaxaRemarcacao,
    calcularTaxaRemarcacaoCliente,
    GATEWAY_PAGAMENTO_REMARCACAO,
    isOrigemRemarcacaoClientePermitida,
    montarHistoricoPixRemarcacaoCriado,
    montarHistoricoRemarcacaoPendente,
    montarIdempotencyKeyRemarcacaoPix,
    parseHistoricoPixRemarcacao,
    parseHistoricoRemarcacaoPendente,
    TAXA_PLATAFORMA_REMARCACAO,
    TAXA_REMARCACAO_CLIENTE,
    VALOR_POUSADA_REMARCACAO,
} from './hospedagemRemarcacaoClientePolicy';

const checkinBase = new Date('2026-10-10T19:00:00.000Z');

function horasAntes(h: number, minutosExtra = 0): Date {
    return new Date(
        checkinBase.getTime() - (h * 60 + minutosExtra) * 60 * 1000
    );
}

describe('calcularTaxaRemarcacaoCliente — tempo', () => {
    it('100h → gratuito', () => {
        assert.equal(calcularTaxaRemarcacaoCliente(100), 0);
    });

    it('73h → gratuito', () => {
        assert.equal(calcularTaxaRemarcacaoCliente(73), 0);
    });

    it('72h → taxa configurada', () => {
        assert.equal(calcularTaxaRemarcacaoCliente(72), TAXA_REMARCACAO_CLIENTE);
    });

    it('71h → taxa configurada', () => {
        assert.equal(calcularTaxaRemarcacaoCliente(71), TAXA_REMARCACAO_CLIENTE);
    });

    it('13h → taxa configurada', () => {
        assert.equal(calcularTaxaRemarcacaoCliente(13), TAXA_REMARCACAO_CLIENTE);
    });

    it('12h → bloqueado', () => {
        assert.equal(calcularTaxaRemarcacaoCliente(12), null);
    });

    it('11h → bloqueado', () => {
        assert.equal(calcularTaxaRemarcacaoCliente(11), null);
    });
});

describe('elegibilidade — independente da forma de pagamento', () => {
    const reservaAtendenteComToken = {
        status: StatusReservaHospedagem.Confirmada,
        origemReserva: 'ATENDENTE',
        tokenPagamento: 'tok-pagamento',
        checkin: checkinBase,
    };

    const reservaCliente = {
        status: StatusReservaHospedagem.Confirmada,
        origemReserva: 'CLIENTE',
        checkin: checkinBase,
    };

    it('Caso A: Confirmada + 50h + origem ATENDENTE/token (ex.: comprovante transacao:11918) → podeRemarcar taxa configurada', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: reservaAtendenteComToken,
            agora: horasAntes(50),
        });
        assert.equal(r.podeRemarcar, true);
        assert.equal(r.taxaRemarcacao, TAXA_REMARCACAO_CLIENTE);
    });

    it('Caso A variante: Confirmada + 50h + origem CLIENTE → podeRemarcar taxa configurada', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: reservaCliente,
            agora: horasAntes(50),
        });
        assert.equal(r.podeRemarcar, true);
        assert.equal(r.taxaRemarcacao, TAXA_REMARCACAO_CLIENTE);
    });

    it('Caso B: Confirmada + 80h + qualquer origem permitida → podeRemarcar taxa R$0', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: reservaCliente,
            agora: horasAntes(80),
        });
        assert.equal(r.podeRemarcar, true);
        assert.equal(r.taxaRemarcacao, 0);
    });

    it('Caso C: Confirmada + 10h → não podeRemarcar', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: reservaAtendenteComToken,
            agora: horasAntes(10),
        });
        assert.equal(r.podeRemarcar, false);
        assert.equal(
            r.motivoBloqueio,
            'Remarcação não permitida com menos de 12 horas para o check-in.'
        );
    });

    it('reserva #131: ~1,58h para check-in → não pode iniciar nova remarcação', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: reservaAtendenteComToken,
            agora: horasAntes(1.58),
        });
        assert.equal(r.podeRemarcar, false);
        assert.ok((r.horasRestantes ?? 0) <= 12);
    });
});

describe('isOrigemRemarcacaoClientePermitida', () => {
    it('CLIENTE e SITE → permitido', () => {
        assert.equal(
            isOrigemRemarcacaoClientePermitida({ origemReserva: 'CLIENTE' }),
            true
        );
        assert.equal(
            isOrigemRemarcacaoClientePermitida({ origemReserva: 'SITE' }),
            true
        );
    });

    it('ATENDENTE + token → permitido', () => {
        assert.equal(
            isOrigemRemarcacaoClientePermitida({
                origemReserva: 'ATENDENTE',
                tokenPagamento: 'tok',
            }),
            true
        );
    });

    it('ATENDENTE sem token → bloqueado', () => {
        assert.equal(
            isOrigemRemarcacaoClientePermitida({ origemReserva: 'ATENDENTE' }),
            false
        );
    });

    it('BOOKING → bloqueado', () => {
        assert.equal(
            isOrigemRemarcacaoClientePermitida({ origemReserva: 'BOOKING' }),
            false
        );
    });
});

describe('avaliarElegibilidadeRemarcacaoCliente — origem', () => {
    const base = {
        status: StatusReservaHospedagem.Confirmada,
        checkin: checkinBase,
    };

    it('CLIENTE → permitido', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: { ...base, origemReserva: 'CLIENTE' },
            agora: horasAntes(100),
        });
        assert.equal(r.podeRemarcar, true);
    });

    it('SITE → permitido', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: { ...base, origemReserva: 'SITE' },
            agora: horasAntes(100),
        });
        assert.equal(r.podeRemarcar, true);
    });

    it('ATENDENTE + token → permitido', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: {
                ...base,
                origemReserva: 'ATENDENTE',
                tokenPagamento: 'tok123',
            },
            agora: horasAntes(100),
        });
        assert.equal(r.podeRemarcar, true);
    });

    it('ATENDENTE sem token → bloqueado', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: { ...base, origemReserva: 'ATENDENTE' },
            agora: horasAntes(100),
        });
        assert.equal(r.podeRemarcar, false);
    });

    it('BOOKING → bloqueado', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: { ...base, origemReserva: 'BOOKING' },
            agora: horasAntes(100),
        });
        assert.equal(r.podeRemarcar, false);
    });

    it('AIRBNB → bloqueado', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: { ...base, origemReserva: 'AIRBNB' },
            agora: horasAntes(100),
        });
        assert.equal(r.podeRemarcar, false);
    });

    it('HOSPEDIN → bloqueado', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: { ...base, origemReserva: 'HOSPEDIN' },
            agora: horasAntes(100),
        });
        assert.equal(r.podeRemarcar, false);
    });

    it('TELEFONE → bloqueado', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: { ...base, origemReserva: 'TELEFONE' },
            agora: horasAntes(100),
        });
        assert.equal(r.podeRemarcar, false);
    });

    it('BALCAO → bloqueado', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: { ...base, origemReserva: 'BALCAO' },
            agora: horasAntes(100),
        });
        assert.equal(r.podeRemarcar, false);
    });
});

describe('avaliarElegibilidadeRemarcacaoCliente — status', () => {
    it('Confirmada → permitido', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: {
                status: StatusReservaHospedagem.Confirmada,
                origemReserva: 'CLIENTE',
                checkin: checkinBase,
            },
            agora: horasAntes(100),
        });
        assert.equal(r.podeRemarcar, true);
    });

    it('Hospedada → bloqueado', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: {
                status: StatusReservaHospedagem.Hospedada,
                origemReserva: 'CLIENTE',
                checkin: checkinBase,
            },
            agora: horasAntes(100),
        });
        assert.equal(r.podeRemarcar, false);
    });

    it('Cancelada → bloqueado', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: {
                status: StatusReservaHospedagem.Cancelada,
                origemReserva: 'CLIENTE',
                checkin: checkinBase,
            },
            agora: horasAntes(100),
        });
        assert.equal(r.podeRemarcar, false);
    });

    it('AguardandoPagamento → bloqueado', () => {
        const r = avaliarElegibilidadeRemarcacaoCliente({
            reserva: {
                status: StatusReservaHospedagem.AguardandoPagamento,
                origemReserva: 'CLIENTE',
                checkin: checkinBase,
            },
            agora: horasAntes(100),
        });
        assert.equal(r.podeRemarcar, false);
    });
});

describe('configuração de valores da remarcação', () => {
    it('total R$1,20, plataforma R$0,20, pousada R$1,00 (1,20 - 0,20)', () => {
        assert.equal(TAXA_REMARCACAO_CLIENTE, 1.2);
        assert.equal(TAXA_PLATAFORMA_REMARCACAO, 0.2);
        assert.equal(VALOR_POUSADA_REMARCACAO, 1);
        assert.equal(
            TAXA_REMARCACAO_CLIENTE - TAXA_PLATAFORMA_REMARCACAO,
            VALOR_POUSADA_REMARCACAO
        );
    });
});

describe('calcularSaldoAposTaxaRemarcacao — financeiro', () => {
    it('R$1000 pago + taxa configurada = saldo da taxa', () => {
        const fin = calcularSaldoAposTaxaRemarcacao({
            valorTotalAtual: 1000,
            valorPago: 1000,
            taxaRemarcacao: TAXA_REMARCACAO_CLIENTE,
        });
        assert.equal(fin.valorTotal, 1000 + TAXA_REMARCACAO_CLIENTE);
        assert.equal(fin.valorPago, 1000);
        assert.equal(fin.saldoPendente, TAXA_REMARCACAO_CLIENTE);
    });

    it('após pagamento da taxa → saldo R$0', () => {
        const valorTotalComTaxa = 1000 + TAXA_REMARCACAO_CLIENTE;
        const fin = calcularSaldoAposTaxaRemarcacao({
            valorTotalAtual: valorTotalComTaxa,
            valorPago: valorTotalComTaxa,
            taxaRemarcacao: 0,
        });
        assert.equal(fin.valorTotal, valorTotalComTaxa);
        assert.equal(fin.valorPago, valorTotalComTaxa);
        assert.equal(fin.saldoPendente, 0);
    });
});

describe('múltiplas remarcações — política de tempo independente', () => {
    it('sequência 50h→taxa, 80h→0, 30h→taxa, 15h→taxa, 10h→bloqueado', () => {
        const taxas = [
            calcularTaxaRemarcacaoCliente(50),
            calcularTaxaRemarcacaoCliente(80),
            calcularTaxaRemarcacaoCliente(30),
            calcularTaxaRemarcacaoCliente(15),
            calcularTaxaRemarcacaoCliente(10),
        ];
        assert.deepEqual(taxas, [
            TAXA_REMARCACAO_CLIENTE,
            0,
            TAXA_REMARCACAO_CLIENTE,
            TAXA_REMARCACAO_CLIENTE,
            null,
        ]);
    });
});

describe('pix remarcacao — idempotência e histórico', () => {
    it('idempotency key é estável por taxa', () => {
        assert.equal(
            montarIdempotencyKeyRemarcacaoPix(99),
            'remarcacao-cliente-taxa-99'
        );
        assert.equal(
            montarIdempotencyKeyRemarcacaoPix(99),
            montarIdempotencyKeyRemarcacaoPix(99)
        );
        assert.notEqual(
            montarIdempotencyKeyRemarcacaoPix(99),
            montarIdempotencyKeyRemarcacaoPix(100)
        );
    });

    it('monta e parseia histórico PIX por taxa', () => {
        const descricao = montarHistoricoPixRemarcacaoCriado(55, '987654321');
        const parsed = parseHistoricoPixRemarcacao(descricao);
        assert.deepEqual(parsed, { idTaxa: 55, paymentId: '987654321' });
    });

    it('gateway de remarcação é isolado do fluxo normal', () => {
        assert.equal(GATEWAY_PAGAMENTO_REMARCACAO, 'MercadoPagoRemarcacao');
        assert.notEqual(GATEWAY_PAGAMENTO_REMARCACAO, 'MercadoPago');
    });
});

describe('historico remarcacao pendente', () => {
    it('monta e parseia metadados', () => {
        const checkin = new Date('2026-10-20T19:00:00.000Z');
        const checkout = new Date('2026-10-22T16:00:00.000Z');
        const descricao = montarHistoricoRemarcacaoPendente({
            idReserva: 129,
            idTaxa: 123,
            checkin,
            checkout,
        });
        const parsed = parseHistoricoRemarcacaoPendente(descricao);
        assert.ok(parsed);
        assert.equal(parsed?.idReserva, 129);
        assert.equal(parsed?.idTaxa, 123);
        assert.equal(parsed?.checkin.toISOString(), checkin.toISOString());
        assert.equal(parsed?.checkout.toISOString(), checkout.toISOString());
    });
});
