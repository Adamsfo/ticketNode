import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { Transaction } from 'sequelize';
import {
    EventoSuiteLimpeza,
    StatusEventoSuiteLimpeza,
} from '../models/EventoSuiteLimpeza';
import {
    criarLimpezasPendentesNoCheckout,
    montarLimpezasPendentesCheckout,
} from './eventoSuiteLimpezaCheckoutService';

describe('montarLimpezasPendentesCheckout', () => {
    it('cria um Pendente por ReservaSuite', () => {
        const payloads = montarLimpezasPendentesCheckout(100, [
            { id: 1, idEventoSuite: 10 },
            { id: 2, idEventoSuite: 20 },
        ]);

        assert.equal(payloads.length, 2);
        assert.deepEqual(payloads[0], {
            idReservaHospedagem: 100,
            idReservaSuite: 1,
            idEventoSuite: 10,
            status: StatusEventoSuiteLimpeza.Pendente,
        });
        assert.deepEqual(payloads[1], {
            idReservaHospedagem: 100,
            idReservaSuite: 2,
            idEventoSuite: 20,
            status: StatusEventoSuiteLimpeza.Pendente,
        });
    });

    it('lista vazia quando não há suítes', () => {
        assert.deepEqual(montarLimpezasPendentesCheckout(100, []), []);
    });
});

describe('criarLimpezasPendentesNoCheckout', () => {
    it('chama findOrCreate Pendente para cada suíte', async () => {
        const calls: unknown[] = [];
        const mockTx = { id: 'tx' } as unknown as Transaction;

        const original = EventoSuiteLimpeza.findOrCreate;
        EventoSuiteLimpeza.findOrCreate = (async (options: unknown) => {
            calls.push(options);
            return [{ id: calls.length }, true];
        }) as typeof EventoSuiteLimpeza.findOrCreate;

        try {
            await criarLimpezasPendentesNoCheckout(mockTx, 55, [
                { id: 7, idEventoSuite: 3 },
                { id: 8, idEventoSuite: 4 },
            ]);

            assert.equal(calls.length, 2);
            assert.deepEqual(calls[0], {
                where: { idReservaHospedagem: 55, idEventoSuite: 3 },
                defaults: {
                    idReservaHospedagem: 55,
                    idEventoSuite: 3,
                    idReservaSuite: 7,
                    status: StatusEventoSuiteLimpeza.Pendente,
                },
                transaction: mockTx,
            });
            assert.deepEqual(calls[1], {
                where: { idReservaHospedagem: 55, idEventoSuite: 4 },
                defaults: {
                    idReservaHospedagem: 55,
                    idEventoSuite: 4,
                    idReservaSuite: 8,
                    status: StatusEventoSuiteLimpeza.Pendente,
                },
                transaction: mockTx,
            });
        } finally {
            EventoSuiteLimpeza.findOrCreate = original;
        }
    });

    it('não duplica quando findOrCreate encontra registro existente', async () => {
        let createCount = 0;
        const mockTx = { id: 'tx' } as unknown as Transaction;

        const original = EventoSuiteLimpeza.findOrCreate;
        EventoSuiteLimpeza.findOrCreate = (async () => {
            createCount += 1;
            return [{ id: 99 }, false];
        }) as typeof EventoSuiteLimpeza.findOrCreate;

        try {
            await criarLimpezasPendentesNoCheckout(mockTx, 55, [
                { id: 7, idEventoSuite: 3 },
            ]);
            assert.equal(createCount, 1);
        } finally {
            EventoSuiteLimpeza.findOrCreate = original;
        }
    });

    it('propaga erro para rollback da transação do checkout', async () => {
        const mockTx = { id: 'tx' } as unknown as Transaction;

        const original = EventoSuiteLimpeza.findOrCreate;
        EventoSuiteLimpeza.findOrCreate = mock.fn(async () => {
            throw new Error('falha ao criar limpeza');
        }) as typeof EventoSuiteLimpeza.findOrCreate;

        try {
            await assert.rejects(
                () =>
                    criarLimpezasPendentesNoCheckout(mockTx, 55, [
                        { id: 7, idEventoSuite: 3 },
                    ]),
                /falha ao criar limpeza/
            );
        } finally {
            EventoSuiteLimpeza.findOrCreate = original;
        }
    });
});
