import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { Transaction } from 'sequelize';
import { EventoSuite } from '../models/EventoSuite';
import {
    EventoSuiteLimpeza,
    OrigemEventoSuiteLimpeza,
    StatusEventoSuiteLimpeza,
} from '../models/EventoSuiteLimpeza';
import {
    criarLimpezasPendentesNoCheckout,
    montarLimpezasPendentesCheckout,
} from './eventoSuiteLimpezaCheckoutService';

const mockTx = {
    LOCK: { UPDATE: 'UPDATE' },
} as unknown as Transaction;

function limpezaAberta(
    idEventoSuite: number,
    status: StatusEventoSuiteLimpeza,
    origem: OrigemEventoSuiteLimpeza = OrigemEventoSuiteLimpeza.Checkout
) {
    return {
        id: 1,
        idEventoSuite,
        status,
        origem,
        idReservaHospedagem: origem === OrigemEventoSuiteLimpeza.Manual ? null : 55,
        idReservaSuite: origem === OrigemEventoSuiteLimpeza.Manual ? null : 7,
    };
}

function instalarMocksCheckoutLimpeza(params: {
    limpezasAbertasPorSuite?: Map<number, ReturnType<typeof limpezaAberta> | null>;
    suitesExistentes?: Set<number>;
}) {
    const limpezasAbertas =
        params.limpezasAbertasPorSuite ?? new Map<number, ReturnType<typeof limpezaAberta> | null>();
    const suitesExistentes = params.suitesExistentes ?? new Set([3, 4, 5, 10, 20]);

    const originalSuiteFindByPk = EventoSuite.findByPk;
    const originalLimpezaFindOne = EventoSuiteLimpeza.findOne;
    const originalFindOrCreate = EventoSuiteLimpeza.findOrCreate;

    EventoSuite.findByPk = (async (id: number) => {
        if (!suitesExistentes.has(id)) return null;
        return { id };
    }) as typeof EventoSuite.findByPk;

    EventoSuiteLimpeza.findOne = (async (options: {
        where?: { idEventoSuite?: number; status?: unknown };
    }) => {
        const idSuite = options?.where?.idEventoSuite;
        if (!idSuite || !options?.where?.status) return null;
        return limpezasAbertas.get(idSuite) ?? null;
    }) as typeof EventoSuiteLimpeza.findOne;

    const findOrCreateCalls: unknown[] = [];
    EventoSuiteLimpeza.findOrCreate = (async (options: unknown) => {
        findOrCreateCalls.push(options);
        return [{ id: findOrCreateCalls.length }, true];
    }) as typeof EventoSuiteLimpeza.findOrCreate;

    return {
        findOrCreateCalls,
        restore() {
            EventoSuite.findByPk = originalSuiteFindByPk;
            EventoSuiteLimpeza.findOne = originalLimpezaFindOne;
            EventoSuiteLimpeza.findOrCreate = originalFindOrCreate;
        },
    };
}

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
    it('A. suíte sem limpeza aberta + checkout cria CHECKOUT', async () => {
        const mocks = instalarMocksCheckoutLimpeza({});
        try {
            await criarLimpezasPendentesNoCheckout(mockTx, 55, [
                { id: 7, idEventoSuite: 3 },
            ]);
            assert.equal(mocks.findOrCreateCalls.length, 1);
            const opts = mocks.findOrCreateCalls[0] as {
                defaults: { origem: string };
            };
            assert.equal(opts.defaults.origem, OrigemEventoSuiteLimpeza.Checkout);
        } finally {
            mocks.restore();
        }
    });

    it('B. limpeza MANUAL Pendente + checkout não cria segunda', async () => {
        const mocks = instalarMocksCheckoutLimpeza({
            limpezasAbertasPorSuite: new Map([
                [
                    5,
                    limpezaAberta(
                        5,
                        StatusEventoSuiteLimpeza.Pendente,
                        OrigemEventoSuiteLimpeza.Manual
                    ),
                ],
            ]),
        });
        try {
            await criarLimpezasPendentesNoCheckout(mockTx, 117, [
                { id: 500, idEventoSuite: 5 },
            ]);
            assert.equal(mocks.findOrCreateCalls.length, 0);
        } finally {
            mocks.restore();
        }
    });

    it('C. limpeza MANUAL EmAndamento + checkout não cria segunda', async () => {
        const mocks = instalarMocksCheckoutLimpeza({
            limpezasAbertasPorSuite: new Map([
                [
                    5,
                    limpezaAberta(
                        5,
                        StatusEventoSuiteLimpeza.EmAndamento,
                        OrigemEventoSuiteLimpeza.Manual
                    ),
                ],
            ]),
        });
        try {
            await criarLimpezasPendentesNoCheckout(mockTx, 117, [
                { id: 500, idEventoSuite: 5 },
            ]);
            assert.equal(mocks.findOrCreateCalls.length, 0);
        } finally {
            mocks.restore();
        }
    });

    it('D. limpeza CHECKOUT Pendente + checkout não duplica', async () => {
        const mocks = instalarMocksCheckoutLimpeza({
            limpezasAbertasPorSuite: new Map([
                [
                    3,
                    limpezaAberta(3, StatusEventoSuiteLimpeza.Pendente),
                ],
            ]),
        });
        try {
            await criarLimpezasPendentesNoCheckout(mockTx, 55, [
                { id: 7, idEventoSuite: 3 },
            ]);
            assert.equal(mocks.findOrCreateCalls.length, 0);
        } finally {
            mocks.restore();
        }
    });

    it('E. limpeza CHECKOUT Concluida + checkout permite nova', async () => {
        const mocks = instalarMocksCheckoutLimpeza({
            limpezasAbertasPorSuite: new Map([[3, null]]),
        });
        try {
            await criarLimpezasPendentesNoCheckout(mockTx, 200, [
                { id: 9, idEventoSuite: 3 },
            ]);
            assert.equal(mocks.findOrCreateCalls.length, 1);
        } finally {
            mocks.restore();
        }
    });

    it('F. limpeza MANUAL Concluida + checkout permite CHECKOUT', async () => {
        const mocks = instalarMocksCheckoutLimpeza({
            limpezasAbertasPorSuite: new Map([[5, null]]),
        });
        try {
            await criarLimpezasPendentesNoCheckout(mockTx, 117, [
                { id: 500, idEventoSuite: 5 },
            ]);
            assert.equal(mocks.findOrCreateCalls.length, 1);
        } finally {
            mocks.restore();
        }
    });

    it('G. limpeza aberta em uma suíte não impede checkout de outra', async () => {
        const mocks = instalarMocksCheckoutLimpeza({
            limpezasAbertasPorSuite: new Map([
                [
                    3,
                    limpezaAberta(
                        3,
                        StatusEventoSuiteLimpeza.Pendente,
                        OrigemEventoSuiteLimpeza.Manual
                    ),
                ],
                [4, null],
            ]),
        });
        try {
            await criarLimpezasPendentesNoCheckout(mockTx, 55, [
                { id: 7, idEventoSuite: 3 },
                { id: 8, idEventoSuite: 4 },
            ]);
            assert.equal(mocks.findOrCreateCalls.length, 1);
            const opts = mocks.findOrCreateCalls[0] as {
                where: { idEventoSuite: number };
            };
            assert.equal(opts.where.idEventoSuite, 4);
        } finally {
            mocks.restore();
        }
    });

    it('chama findOrCreate Pendente para cada suíte sem limpeza aberta', async () => {
        const mocks = instalarMocksCheckoutLimpeza({});
        try {
            await criarLimpezasPendentesNoCheckout(mockTx, 55, [
                { id: 7, idEventoSuite: 3 },
                { id: 8, idEventoSuite: 4 },
            ]);

            assert.equal(mocks.findOrCreateCalls.length, 2);
            assert.deepEqual(mocks.findOrCreateCalls[0], {
                where: { idReservaHospedagem: 55, idEventoSuite: 3 },
                defaults: {
                    idReservaHospedagem: 55,
                    idEventoSuite: 3,
                    idReservaSuite: 7,
                    status: StatusEventoSuiteLimpeza.Pendente,
                    origem: OrigemEventoSuiteLimpeza.Checkout,
                },
                transaction: mockTx,
            });
            assert.deepEqual(mocks.findOrCreateCalls[1], {
                where: { idReservaHospedagem: 55, idEventoSuite: 4 },
                defaults: {
                    idReservaHospedagem: 55,
                    idEventoSuite: 4,
                    idReservaSuite: 8,
                    status: StatusEventoSuiteLimpeza.Pendente,
                    origem: OrigemEventoSuiteLimpeza.Checkout,
                },
                transaction: mockTx,
            });
        } finally {
            mocks.restore();
        }
    });

    it('não duplica quando findOrCreate encontra registro existente', async () => {
        const mocks = instalarMocksCheckoutLimpeza({});
        let createCount = 0;
        const originalFindOrCreate = EventoSuiteLimpeza.findOrCreate;
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
            EventoSuiteLimpeza.findOrCreate = originalFindOrCreate;
            mocks.restore();
        }
    });

    it('propaga erro para rollback da transação do checkout', async () => {
        const mocks = instalarMocksCheckoutLimpeza({});
        const originalFindOrCreate = EventoSuiteLimpeza.findOrCreate;
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
            EventoSuiteLimpeza.findOrCreate = originalFindOrCreate;
            mocks.restore();
        }
    });
});
