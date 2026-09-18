/**
 * node --require ts-node/register/transpile-only --test \
 *   src/services/hospedagemRemarcacaoClienteService.test.ts
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ReservaSuite } from '../models/ReservaSuite';
import { CustomError } from '../utils/customError';
import {
    montarHistoricoRemarcacaoPendente,
    parseHistoricoRemarcacaoPendente,
} from './hospedagemRemarcacaoClientePolicy';

const checkinNovo = new Date('2026-09-20T20:00:00.000Z');
const checkoutNovo = new Date('2026-09-21T17:00:00.000Z');

function montarReservaRemarcacao131(
    eventoSuite: {
        id: number;
        nome: string;
        status: string;
        qtdeMinimaPessoas: number;
        qtdeMaximaPessoas: number;
    } | null
) {
    return {
        id: 131,
        status: 'Confirmada',
        checkin: new Date('2026-09-18T20:00:00.000Z'),
        checkout: new Date('2026-09-19T17:00:00.000Z'),
        ReservaSuite: [
            {
                id: 131,
                idReservaHospedagem: 131,
                idEventoSuite: 21,
                adultos: 1,
                criancas: 0,
                EventoSuite: eventoSuite,
            },
        ],
    };
}

afterEach(() => {
    mock.restoreAll();
});

describe('remarcação pendente — atualização de datas no histórico', () => {
    it('histórico pendente pode ser regravado com novas datas mantendo a mesma taxa', () => {
        const idReserva = 129;
        const idTaxa = 55;
        const checkinAntigo = new Date('2026-10-20T19:00:00.000Z');
        const checkoutAntigo = new Date('2026-10-22T16:00:00.000Z');
        const checkinNovo = new Date('2026-10-25T19:00:00.000Z');
        const checkoutNovo = new Date('2026-10-27T16:00:00.000Z');

        const descricaoAntiga = montarHistoricoRemarcacaoPendente({
            idReserva,
            idTaxa,
            checkin: checkinAntigo,
            checkout: checkoutAntigo,
        });
        const descricaoNova = montarHistoricoRemarcacaoPendente({
            idReserva,
            idTaxa,
            checkin: checkinNovo,
            checkout: checkoutNovo,
        });

        const parsedAntigo = parseHistoricoRemarcacaoPendente(descricaoAntiga);
        const parsedNovo = parseHistoricoRemarcacaoPendente(descricaoNova);

        assert.ok(parsedAntigo);
        assert.ok(parsedNovo);
        assert.equal(parsedAntigo?.idTaxa, idTaxa);
        assert.equal(parsedNovo?.idTaxa, idTaxa);
        assert.notEqual(
            parsedAntigo?.checkin.toISOString(),
            parsedNovo?.checkin.toISOString()
        );
        assert.equal(parsedNovo?.checkin.toISOString(), checkinNovo.toISOString());
        assert.equal(parsedNovo?.checkout.toISOString(), checkoutNovo.toISOString());
    });
});

describe('validarDisponibilidadeRemarcacao — suíte da própria reserva', () => {
    it('reserva #131: suíte Oculto + novo período livre → não bloqueia por status cadastral', async () => {
        mock.method(ReservaSuite, 'findAll', async () => [
            {
                idReservaHospedagem: 131,
                ReservaHospedagem: {
                    id: 131,
                    status: 'Confirmada',
                    checkin: new Date('2026-09-18T20:00:00.000Z'),
                    checkout: new Date('2026-09-19T17:00:00.000Z'),
                    saldoPendente: 0,
                },
            },
        ]);

        const { validarDisponibilidadeRemarcacao } = await import(
            './hospedagemRemarcacaoClienteService'
        );

        const reserva = montarReservaRemarcacao131({
            id: 21,
            nome: 'suite teste 3',
            status: 'Oculto',
            qtdeMinimaPessoas: 1,
            qtdeMaximaPessoas: 1,
        });

        await validarDisponibilidadeRemarcacao(
            reserva as any,
            checkinNovo,
            checkoutNovo
        );
    });

    it('novo período ocupado por outra reserva → bloqueia por conflito de período', async () => {
        mock.method(ReservaSuite, 'findAll', async () => [
            {
                idReservaHospedagem: 200,
                ReservaHospedagem: {
                    id: 200,
                    status: 'Confirmada',
                    checkin: new Date('2026-09-20T20:00:00.000Z'),
                    checkout: new Date('2026-09-21T17:00:00.000Z'),
                    saldoPendente: 0,
                },
            },
        ]);

        const { validarDisponibilidadeRemarcacao } = await import(
            './hospedagemRemarcacaoClienteService'
        );

        const reserva = montarReservaRemarcacao131({
            id: 21,
            nome: 'suite teste 3',
            status: 'Oculto',
            qtdeMinimaPessoas: 1,
            qtdeMaximaPessoas: 1,
        });

        await assert.rejects(
            () =>
                validarDisponibilidadeRemarcacao(
                    reserva as any,
                    checkinNovo,
                    checkoutNovo
                ),
            (error: unknown) => {
                assert.ok(error instanceof CustomError);
                assert.match(
                    String(error.message),
                    /indisponível no período/i
                );
                return true;
            }
        );
    });

    it('suíte inexistente na ReservaSuite → erro', async () => {
        const { validarDisponibilidadeRemarcacao } = await import(
            './hospedagemRemarcacaoClienteService'
        );

        const reserva = montarReservaRemarcacao131(null);

        await assert.rejects(
            () =>
                validarDisponibilidadeRemarcacao(
                    reserva as any,
                    checkinNovo,
                    checkoutNovo
                ),
            (error: unknown) => {
                assert.ok(error instanceof CustomError);
                assert.match(String(error.message), /não está disponível/i);
                return true;
            }
        );
    });
});
