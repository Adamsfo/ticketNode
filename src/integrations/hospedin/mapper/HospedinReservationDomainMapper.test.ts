/**
 * Contagem operacional adultos/crianças — Hospedin → Jango.
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/mapper/HospedinReservationDomainMapper.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HospedinReservation } from '../../../models/HospedinReservation';
import { TipoReservaHospede } from '../../../models/ReservaHospede';
import {
    HospedinReservationDomainMapper,
    resolveOperationalGuestCounts,
} from './HospedinReservationDomainMapper';

const resolvedSuite = {
    found: true as const,
    idEventoSuite: 10,
    idEvento: 5,
    placeId: 445906,
};

function makeStaging(
    payload: Record<string, unknown>,
    reservationId = 900001
): HospedinReservation {
    return {
        reservation_id: reservationId,
        status: 'reservation',
        checkin: new Date('2026-10-18T17:00:00.000Z'),
        checkout: new Date('2026-10-20T15:00:00.000Z'),
        payload_json: {
            id: reservationId,
            status: 'reservation',
            check_in: '2026-10-18T14:00:00-03:00',
            check_out: '2026-10-20T12:00:00-03:00',
            place_id: 445906,
            ...payload,
        },
        imported_at: new Date(),
        updated_at: new Date(),
    } as HospedinReservation;
}

function adultGuest(name: string) {
    return { name, type: 'adult' };
}

function childGuest(name: string, birth = '2018-05-10') {
    return { name, type: 'child', birth };
}

function mapCounts(staging: HospedinReservation) {
    const create = HospedinReservationDomainMapper.toCreateParams({
        staging,
        resolvedSuite,
    });
    const update = HospedinReservationDomainMapper.toUpdateSnapshot({
        staging,
        resolvedSuite,
    });
    return {
        create: {
            adultos: create.suites[0].adultos,
            criancas: create.suites[0].criancas,
            hospedes: create.suites[0].hospedes,
        },
        update: {
            adultos: update.adultos,
            criancas: update.criancas,
            hospedes: update.hospedes,
        },
    };
}

describe('resolveOperationalGuestCounts', () => {
    it('usa payload.adults/children como fonte primária com titular único', () => {
        const counts = resolveOperationalGuestCounts(
            { adults: 2, children: 2 },
            [
                {
                    nome: 'Titular',
                    tipo: TipoReservaHospede.Adulto,
                    dataNascimento: null,
                },
            ]
        );
        assert.deepEqual(counts, { adultos: 2, criancas: 2 });
    });

    it('fallback para hóspedes nomeados quando payload não informa contadores', () => {
        const counts = resolveOperationalGuestCounts(
            {},
            [
                {
                    nome: 'Adulto A',
                    tipo: TipoReservaHospede.Adulto,
                    dataNascimento: null,
                },
                {
                    nome: 'Criança B',
                    tipo: TipoReservaHospede.Crianca,
                    dataNascimento: new Date('2018-01-01'),
                },
            ]
        );
        assert.deepEqual(counts, { adultos: 1, criancas: 1 });
    });
});

describe('HospedinReservationDomainMapper — contagens operacionais', () => {
    it('1 adulto + 0 crianças', () => {
        const { create, update } = mapCounts(
            makeStaging({
                adults: 1,
                children: 0,
                guests: [adultGuest('Titular')],
            })
        );
        assert.equal(create.adultos, 1);
        assert.equal(create.criancas, 0);
        assert.equal(create.hospedes.length, 1);
        assert.equal(create.hospedes[0].nome, 'Titular');
        assert.equal(create.hospedes[0].tipo, TipoReservaHospede.Adulto);
        assert.deepEqual(
            { adultos: update.adultos, criancas: update.criancas },
            { adultos: 1, criancas: 0 }
        );
    });

    it('2 adultos + 0 crianças com titular único', () => {
        const { create, update } = mapCounts(
            makeStaging({
                adults: 2,
                children: 0,
                guests: [adultGuest('Titular')],
            })
        );
        assert.deepEqual(
            { adultos: create.adultos, criancas: create.criancas },
            { adultos: 2, criancas: 0 }
        );
        assert.equal(create.hospedes.length, 1);
        assert.deepEqual(
            { adultos: update.adultos, criancas: update.criancas },
            { adultos: 2, criancas: 0 }
        );
    });

    it('2 adultos + 1 criança com titular único', () => {
        const { create, update } = mapCounts(
            makeStaging({
                adults: 2,
                children: 1,
                guests: [adultGuest('Titular')],
            })
        );
        assert.deepEqual(
            { adultos: create.adultos, criancas: create.criancas },
            { adultos: 2, criancas: 1 }
        );
        assert.equal(create.hospedes.length, 1);
        assert.deepEqual(
            { adultos: update.adultos, criancas: update.criancas },
            { adultos: 2, criancas: 1 }
        );
    });

    it('2 adultos + 2 crianças com titular único', () => {
        const { create, update } = mapCounts(
            makeStaging({
                adults: 2,
                children: 2,
                guests: [adultGuest('Titular')],
            })
        );
        assert.deepEqual(
            { adultos: create.adultos, criancas: create.criancas },
            { adultos: 2, criancas: 2 }
        );
        assert.equal(create.hospedes.length, 1);
        assert.deepEqual(
            { adultos: update.adultos, criancas: update.criancas },
            { adultos: 2, criancas: 2 }
        );
    });

    it('4 adultos + 0 crianças com titular único', () => {
        const { create, update } = mapCounts(
            makeStaging({
                adults: 4,
                children: 0,
                guests: [adultGuest('Titular')],
            })
        );
        assert.deepEqual(
            { adultos: create.adultos, criancas: create.criancas },
            { adultos: 4, criancas: 0 }
        );
        assert.deepEqual(
            { adultos: update.adultos, criancas: update.criancas },
            { adultos: 4, criancas: 0 }
        );
    });

    it('2 adultos + 2 crianças com lista completa nomeada', () => {
        const { create, update } = mapCounts(
            makeStaging({
                adults: 2,
                children: 2,
                guests: [
                    adultGuest('Adulto A'),
                    adultGuest('Adulto B'),
                    childGuest('Criança C'),
                    childGuest('Criança D'),
                ],
            })
        );
        assert.deepEqual(
            { adultos: create.adultos, criancas: create.criancas },
            { adultos: 2, criancas: 2 }
        );
        assert.equal(create.hospedes.length, 4);
        assert.deepEqual(
            { adultos: update.adultos, criancas: update.criancas },
            { adultos: 2, criancas: 2 }
        );
    });

    it('CREATE e UPDATE produzem as mesmas quantidades para o mesmo payload', () => {
        const cases = [
            { adults: 1, children: 0 },
            { adults: 2, children: 0 },
            { adults: 2, children: 1 },
            { adults: 2, children: 2 },
            { adults: 4, children: 0 },
        ];
        for (const c of cases) {
            const { create, update } = mapCounts(
                makeStaging({
                    ...c,
                    guests: [adultGuest('Titular')],
                })
            );
            assert.deepEqual(
                { adultos: create.adultos, criancas: create.criancas },
                { adultos: update.adultos, criancas: update.criancas },
                `payload ${c.adults}+${c.children}`
            );
        }
    });

    it('children=0 não cria criança artificial', () => {
        const { create } = mapCounts(
            makeStaging({
                adults: 2,
                children: 0,
                guests: [adultGuest('Titular')],
            })
        );
        assert.equal(create.criancas, 0);
        assert.equal(
            create.hospedes.filter((h) => h.tipo === TipoReservaHospede.Crianca)
                .length,
            0
        );
    });

    it('titular único não reduz adultos quando payload.adults > 1', () => {
        const { create } = mapCounts(
            makeStaging({
                adults: 3,
                children: 0,
                main_guest: adultGuest('Titular'),
            })
        );
        assert.equal(create.adultos, 3);
        assert.equal(create.hospedes.length, 1);
    });

    it('parâmetros de checkout (ReservationCreationService) recebem contagens do payload', () => {
        const params = HospedinReservationDomainMapper.toCreateParams({
            staging: makeStaging({
                adults: 2,
                children: 2,
                guests: [adultGuest('Titular')],
            }),
            resolvedSuite,
        });
        assert.equal(params.suites[0].adultos, 2);
        assert.equal(params.suites[0].criancas, 2);
        assert.equal(params.suites[0].hospedes.length, 1);
    });
});
