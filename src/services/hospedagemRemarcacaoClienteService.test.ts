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

describe('validarQuantidadeNoitesRemarcacaoCliente', () => {
    const checkinOriginal = new Date(2026, 9, 5, 16, 0, 0);
    const checkoutOriginal1 = new Date(2026, 9, 6, 13, 0, 0);
    const checkoutOriginal2 = new Date(2026, 9, 7, 13, 0, 0);
    const checkoutOriginal3 = new Date(2026, 9, 8, 13, 0, 0);

    const novoCi = new Date(2026, 9, 10, 16, 0, 0);
    const novoCo1 = new Date(2026, 9, 11, 13, 0, 0);
    const novoCo2 = new Date(2026, 9, 12, 13, 0, 0);
    const novoCo3 = new Date(2026, 9, 13, 13, 0, 0);
    const novoCo0 = new Date(2026, 9, 10, 20, 0, 0);

    async function validar() {
        const mod = await import('./hospedagemRemarcacaoClienteService');
        return mod.validarQuantidadeNoitesRemarcacaoCliente;
    }

    it('permite original 1 noite → nova data 1 noite', async () => {
        const fn = await validar();
        fn(
            { noites: 1, checkin: checkinOriginal, checkout: checkoutOriginal1 },
            novoCi,
            novoCo1
        );
    });

    it('permite original 2 noites → nova data 2 noites', async () => {
        const fn = await validar();
        fn(
            {
                noites: 2,
                checkin: checkinOriginal,
                checkout: checkoutOriginal2,
            },
            novoCi,
            novoCo2
        );
    });

    it('permite original 3 noites → nova data 3 noites', async () => {
        const fn = await validar();
        fn(
            {
                noites: 3,
                checkin: checkinOriginal,
                checkout: checkoutOriginal3,
            },
            novoCi,
            novoCo3
        );
    });

    it('bloqueia 1 → 2 noites', async () => {
        const fn = await validar();
        assert.throws(
            () =>
                fn(
                    {
                        noites: 1,
                        checkin: checkinOriginal,
                        checkout: checkoutOriginal1,
                    },
                    novoCi,
                    novoCo2
                ),
            (e: unknown) => {
                assert.ok(e instanceof CustomError);
                assert.match(String(e.message), /mesma quantidade de noites/i);
                return true;
            }
        );
    });

    it('bloqueia 1 → 3 noites', async () => {
        const fn = await validar();
        assert.throws(
            () =>
                fn(
                    {
                        noites: 1,
                        checkin: checkinOriginal,
                        checkout: checkoutOriginal1,
                    },
                    novoCi,
                    novoCo3
                ),
            (e: unknown) => e instanceof CustomError
        );
    });

    it('bloqueia 2 → 1 noite', async () => {
        const fn = await validar();
        assert.throws(
            () =>
                fn(
                    {
                        noites: 2,
                        checkin: checkinOriginal,
                        checkout: checkoutOriginal2,
                    },
                    novoCi,
                    novoCo1
                ),
            (e: unknown) => e instanceof CustomError
        );
    });

    it('bloqueia 2 → 3 noites', async () => {
        const fn = await validar();
        assert.throws(
            () =>
                fn(
                    {
                        noites: 2,
                        checkin: checkinOriginal,
                        checkout: checkoutOriginal2,
                    },
                    novoCi,
                    novoCo3
                ),
            (e: unknown) => e instanceof CustomError
        );
    });

    it('bloqueia 3 → 1 noite', async () => {
        const fn = await validar();
        assert.throws(
            () =>
                fn(
                    {
                        noites: 3,
                        checkin: checkinOriginal,
                        checkout: checkoutOriginal3,
                    },
                    novoCi,
                    novoCo1
                ),
            (e: unknown) => e instanceof CustomError
        );
    });

    it('bloqueia 3 → 2 noites', async () => {
        const fn = await validar();
        assert.throws(
            () =>
                fn(
                    {
                        noites: 3,
                        checkin: checkinOriginal,
                        checkout: checkoutOriginal3,
                    },
                    novoCi,
                    novoCo2
                ),
            (e: unknown) => e instanceof CustomError
        );
    });

    it('bloqueia qualquer quantidade → 0 noites', async () => {
        const fn = await validar();
        assert.throws(
            () =>
                fn(
                    {
                        noites: 1,
                        checkin: checkinOriginal,
                        checkout: checkoutOriginal1,
                    },
                    novoCi,
                    novoCo0
                ),
            (e: unknown) => {
                assert.ok(e instanceof CustomError);
                assert.match(String(e.message), /mínimo 1 noite/i);
                return true;
            }
        );
    });
});

describe('alterarPeriodoReservaCliente — noites preservadas', () => {
    it('mantém noites=1 após remarcação válida', async () => {
        const { ReservaPeriodoMovimentacao } = await import(
            '../models/ReservaPeriodoMovimentacao'
        );
        const connection = (await import('../database')).default;
        mock.method(ReservaPeriodoMovimentacao, 'create', async () => ({ id: 1 }));
        mock.method(connection, 'transaction', async (fn: (t: unknown) => Promise<void>) => {
            await fn({});
        });

        const updates: Array<Record<string, unknown>> = [];
        const checkin = new Date(2026, 9, 5, 16, 0, 0);
        const checkout = new Date(2026, 9, 6, 13, 0, 0);
        const novoCi = new Date(2026, 9, 10, 16, 0, 0);
        const novoCo = new Date(2026, 9, 11, 13, 0, 0);
        const reserva = {
            id: 99,
            noites: 1,
            checkin,
            checkout,
            update: async (data: Record<string, unknown>) => {
                updates.push(data);
            },
        };

        const { alterarPeriodoReservaCliente } = await import(
            './hospedagemRemarcacaoClienteService'
        );

        await alterarPeriodoReservaCliente({
            reserva: reserva as any,
            idUsuario: 1,
            checkin: novoCi,
            checkout: novoCo,
        });

        assert.equal(updates.length, 1);
        assert.equal(updates[0].noites, 1);
        assert.equal((updates[0].checkin as Date).getTime(), novoCi.getTime());
        assert.equal((updates[0].checkout as Date).getTime(), novoCo.getTime());
    });

    it('mantém noites=2 após remarcação válida', async () => {
        const { ReservaPeriodoMovimentacao } = await import(
            '../models/ReservaPeriodoMovimentacao'
        );
        const connection = (await import('../database')).default;
        mock.method(ReservaPeriodoMovimentacao, 'create', async () => ({ id: 1 }));
        mock.method(connection, 'transaction', async (fn: (t: unknown) => Promise<void>) => {
            await fn({});
        });

        const updates: Array<Record<string, unknown>> = [];
        const checkin = new Date(2026, 9, 5, 16, 0, 0);
        const checkout = new Date(2026, 9, 7, 13, 0, 0);
        const novoCi = new Date(2026, 9, 15, 16, 0, 0);
        const novoCo = new Date(2026, 9, 17, 13, 0, 0);
        const reserva = {
            id: 100,
            noites: 2,
            checkin,
            checkout,
            update: async (data: Record<string, unknown>) => {
                updates.push(data);
            },
        };

        const { alterarPeriodoReservaCliente } = await import(
            './hospedagemRemarcacaoClienteService'
        );

        await alterarPeriodoReservaCliente({
            reserva: reserva as any,
            idUsuario: 1,
            checkin: novoCi,
            checkout: novoCo,
        });

        assert.equal(updates[0].noites, 2);
    });
});
