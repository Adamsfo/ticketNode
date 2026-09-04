/**
 * Testes — vínculo de reserva Hospedin com ReservaHospedagem existente.
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/services/HospedinReservationExternalLink.test.ts
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import {
    findReservaHospedagemByHospedinIdentifiers,
    reservaMatchesHospedinExternalIds,
} from './ReservationExternalMatchService';
import { resolveExistingReservationLink } from './HospedinReservationLinkService';

type RowLike = {
    id: number;
    origemReserva?: string;
    idExterno?: string | null;
    codigoExterno?: string | null;
};

function stubFindAll(rows: RowLike[]) {
    return mock.method(ReservaHospedagem, 'findAll', async () =>
        rows.map((row) => ({
            id: row.id,
            origemReserva: row.origemReserva ?? 'ATENDENTE',
            idExterno: row.idExterno ?? null,
            codigoExterno: row.codigoExterno ?? null,
        }))
    );
}

describe('findReservaHospedagemByHospedinIdentifiers', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('Cenário 1: encontra por id_externo e não executa CREATE (match ATENDENTE)', async () => {
        const findAll = stubFindAll([
            {
                id: 50,
                origemReserva: 'ATENDENTE',
                idExterno: '30319439',
                codigoExterno: 'HO:001331',
            },
        ]);

        const match = await findReservaHospedagemByHospedinIdentifiers({
            reservationId: 30319439,
            searchableCode: 'HO:001331',
        });

        assert.equal(findAll.mock.callCount(), 1);
        assert.ok(match);
        assert.equal(match?.idReservaHospedagem, 50);
        assert.equal(match?.matchedBy, 'id_externo');
        assert.equal(match?.origemReserva, 'ATENDENTE');
    });

    it('Cenário 2: encontra por codigo_externo quando id_externo não bate', async () => {
        stubFindAll([
            {
                id: 51,
                origemReserva: 'ATENDENTE',
                idExterno: null,
                codigoExterno: 'HO:001332',
            },
        ]);

        const match = await findReservaHospedagemByHospedinIdentifiers({
            reservationId: 99999999,
            searchableCode: 'HO:001332',
        });

        assert.ok(match);
        assert.equal(match?.idReservaHospedagem, 51);
        assert.equal(match?.matchedBy, 'codigo_externo');
    });

    it('Cenário 3: sem correspondência retorna null (CREATE normal)', async () => {
        stubFindAll([]);

        const match = await findReservaHospedagemByHospedinIdentifiers({
            reservationId: 12345678,
            searchableCode: 'HO:009999',
        });

        assert.equal(match, null);
    });

    it('prioriza id_externo quando ambos existem em linhas diferentes', async () => {
        stubFindAll([
            {
                id: 10,
                origemReserva: 'ATENDENTE',
                idExterno: '30319439',
                codigoExterno: 'HO:OTHER',
            },
            {
                id: 11,
                origemReserva: 'ATENDENTE',
                idExterno: 'OTHER',
                codigoExterno: 'HO:001331',
            },
        ]);

        const match = await findReservaHospedagemByHospedinIdentifiers({
            reservationId: 30319439,
            searchableCode: 'HO:001331',
        });

        assert.equal(match?.idReservaHospedagem, 10);
        assert.equal(match?.matchedBy, 'id_externo');
    });
});

describe('reservaMatchesHospedinExternalIds', () => {
    it('confirma match por id_externo', () => {
        const result = reservaMatchesHospedinExternalIds(
            { idExterno: '30319439', codigoExterno: 'HO:001331' },
            { reservationId: 30319439, searchableCode: 'HO:001331' }
        );
        assert.equal(result.matched, true);
        assert.equal(result.matchedBy, 'id_externo');
    });

    it('confirma match por codigo_externo quando id difere', () => {
        const result = reservaMatchesHospedinExternalIds(
            { idExterno: null, codigoExterno: 'HO:001332' },
            { reservationId: 30319686, searchableCode: 'HO:001332' }
        );
        assert.equal(result.matched, true);
        assert.equal(result.matchedBy, 'codigo_externo');
    });

    it('sem correspondência retorna matched false', () => {
        const result = reservaMatchesHospedinExternalIds(
            { idExterno: '111', codigoExterno: 'HO:AAA' },
            { reservationId: 222, searchableCode: 'HO:BBB' }
        );
        assert.equal(result.matched, false);
    });
});

describe('resolveExistingReservationLink', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('Cenário 4: internal_entity_id ATENDENTE com id_externo compatível vincula sem CREATE', async () => {
        const findAll = stubFindAll([]);
        const findByPk = mock.method(ReservaHospedagem, 'findByPk', async () => ({
            id: 50,
            origemReserva: 'ATENDENTE',
            idExterno: '30319439',
            codigoExterno: 'HO:001331',
        }));

        const result = await resolveExistingReservationLink({
            reservationId: 30319439,
            internalEntityId: '50',
            payload: { searchable_code: 'HO:001331' },
        });

        assert.equal(findAll.mock.callCount(), 0);
        assert.equal(findByPk.mock.callCount(), 1);
        assert.ok(result);
        assert.equal(result?.linkOnly, true);
        assert.equal(result?.idReservaHospedagem, 50);
        assert.equal(result?.matchedBy, 'id_externo');
    });

    it('internal_entity_id ATENDENTE sem match externo não vincula', async () => {
        stubFindAll([]);
        mock.method(ReservaHospedagem, 'findByPk', async () => ({
            id: 50,
            origemReserva: 'ATENDENTE',
            idExterno: 'OTHER',
            codigoExterno: 'HO:OTHER',
        }));

        const result = await resolveExistingReservationLink({
            reservationId: 30319439,
            internalEntityId: '50',
            payload: { searchable_code: 'HO:001331' },
        });

        assert.equal(result, null);
    });

    it('internal_entity_id HOSPEDIN com match externo segue UPDATE', async () => {
        stubFindAll([]);
        mock.method(ReservaHospedagem, 'findByPk', async () => ({
            id: 70,
            origemReserva: 'HOSPEDIN',
            idExterno: '40001',
            codigoExterno: 'HO:040001',
        }));

        const result = await resolveExistingReservationLink({
            reservationId: 40001,
            internalEntityId: '70',
            payload: { searchable_code: 'HO:040001' },
        });

        assert.ok(result);
        assert.equal(result?.linkOnly, false);
        assert.equal(result?.idReservaHospedagem, 70);
    });

    it('origem HOSPEDIN => linkOnly false (UPDATE)', async () => {
        stubFindAll([
            {
                id: 70,
                origemReserva: 'HOSPEDIN',
                idExterno: '40001',
            },
        ]);

        const result = await resolveExistingReservationLink({
            reservationId: 40001,
            payload: { searchable_code: 'HO:040001' },
        });

        assert.ok(result);
        assert.equal(result?.linkOnly, false);
        assert.equal(result?.idReservaHospedagem, 70);
    });

    it('origem ATENDENTE => linkOnly true (vincular sem CREATE)', async () => {
        stubFindAll([
            {
                id: 50,
                origemReserva: 'ATENDENTE',
                idExterno: '30319439',
            },
        ]);

        const result = await resolveExistingReservationLink({
            reservationId: 30319439,
            payload: { searchable_code: 'HO:001331' },
        });

        assert.ok(result);
        assert.equal(result?.linkOnly, true);
        assert.equal(result?.idReservaHospedagem, 50);
    });
});
