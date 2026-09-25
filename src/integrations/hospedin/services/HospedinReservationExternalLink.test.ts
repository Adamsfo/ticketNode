/**
 * Testes — vínculo de reserva Hospedin com ReservaHospedagem existente.
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/services/HospedinReservationExternalLink.test.ts
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaSuite } from '../../../models/ReservaSuite';
import { placeSuiteResolver } from './PlaceSuiteResolver';
import {
    findReservaHospedagemByHospedinIdentifiers,
    reservaMatchesHospedinExternalIds,
    resolveHospedinReservaHospedagemMatch,
} from './ReservationExternalMatchService';
import { resolveExistingReservationLink } from './HospedinReservationLinkService';

type RowLike = {
    id: number;
    origemReserva?: string;
    idExterno?: string | null;
    codigoExterno?: string | null;
};

type SuiteRowLike = {
    id: number;
    idReservaHospedagem: number;
    idEventoSuite: number;
    hospedinReservationId: string;
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

function stubSuiteFindAll(rows: SuiteRowLike[]) {
    return mock.method(ReservaSuite, 'findAll', async () =>
        rows.map((row) => ({
            id: row.id,
            idReservaHospedagem: row.idReservaHospedagem,
            idEventoSuite: row.idEventoSuite,
            hospedinReservationId: row.hospedinReservationId,
        }))
    );
}

function stubHospedagemFindByPk(
    row: RowLike | null,
    origemOnly = false
) {
    return mock.method(ReservaHospedagem, 'findByPk', async () => {
        if (!row) return null;
        if (origemOnly) {
            return {
                id: row.id,
                origemReserva: row.origemReserva ?? 'ATENDENTE',
            };
        }
        return {
            id: row.id,
            origemReserva: row.origemReserva ?? 'ATENDENTE',
            idExterno: row.idExterno ?? null,
            codigoExterno: row.codigoExterno ?? null,
        };
    });
}

function stubPlaceResolver(idEventoSuite: number, placeId = 9001) {
    return mock.method(placeSuiteResolver, 'resolveInternalSuite', async () => ({
        found: true as const,
        status: 'LINKED' as const,
        placeId,
        idEventoSuite,
        idEvento: 1,
        mapId: 1,
        mappedAt: new Date(),
        mappedBy: null,
    }));
}

/** Fixture multi-suíte #168 (IDs Hospedin por linha de ReservaSuite). */
const MULTI_SUITE = {
    parentId: 168,
    origem: 'ATENDENTE',
    lines: [
        {
            reservationId: '30665539',
            suiteLineId: 170,
            idEventoSuite: 5,
            placeId: 501,
        },
        {
            reservationId: '30665540',
            suiteLineId: 171,
            idEventoSuite: 6,
            placeId: 502,
        },
        {
            reservationId: '30665541',
            suiteLineId: 172,
            idEventoSuite: 7,
            placeId: 503,
        },
    ],
} as const;

function setupMultiSuiteLine(
    line: (typeof MULTI_SUITE.lines)[number]
) {
    stubFindAll([]);
    stubSuiteFindAll([
        {
            id: line.suiteLineId,
            idReservaHospedagem: MULTI_SUITE.parentId,
            idEventoSuite: line.idEventoSuite,
            hospedinReservationId: line.reservationId,
        },
    ]);
    stubHospedagemFindByPk(
        {
            id: MULTI_SUITE.parentId,
            origemReserva: MULTI_SUITE.origem,
        },
        true
    );
    stubPlaceResolver(line.idEventoSuite, line.placeId);
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

describe('resolveHospedinReservaHospedagemMatch — multi-suíte ReservaSuite', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    for (const line of MULTI_SUITE.lines) {
        it(`Teste ${line.reservationId}: LINKED_EXISTING via ReservaSuite ${line.suiteLineId} → pai ${MULTI_SUITE.parentId}`, async () => {
            setupMultiSuiteLine(line);

            const outcome = await resolveHospedinReservaHospedagemMatch({
                reservationId: line.reservationId,
                placeId: line.placeId,
            });

            assert.equal(outcome.status, 'matched');
            if (outcome.status !== 'matched') return;
            assert.equal(outcome.match.idReservaHospedagem, MULTI_SUITE.parentId);
            assert.equal(outcome.match.matchedBy, 'hospedin_reservation_id');
            assert.equal(outcome.match.origemReserva, 'ATENDENTE');
        });
    }

    it('Teste 4: ID inexistente no cabeçalho e ReservaSuite → not_found', async () => {
        stubFindAll([]);
        stubSuiteFindAll([]);

        const outcome = await resolveHospedinReservaHospedagemMatch({
            reservationId: 99988877,
            placeId: 501,
        });

        assert.equal(outcome.status, 'not_found');
    });

    it('Teste 5: place_id incompatível com suíte da linha → place_mismatch', async () => {
        setupMultiSuiteLine(MULTI_SUITE.lines[0]);
        mock.restoreAll();
        stubFindAll([]);
        stubSuiteFindAll([
            {
                id: 170,
                idReservaHospedagem: 168,
                idEventoSuite: 5,
                hospedinReservationId: '30665539',
            },
        ]);
        stubHospedagemFindByPk({ id: 168, origemReserva: 'ATENDENTE' }, true);
        mock.method(placeSuiteResolver, 'resolveInternalSuite', async () => ({
            found: true as const,
            status: 'LINKED' as const,
            placeId: 999,
            idEventoSuite: 99,
            idEvento: 1,
            mapId: 1,
            mappedAt: new Date(),
            mappedBy: null,
        }));

        const outcome = await resolveHospedinReservaHospedagemMatch({
            reservationId: '30665539',
            placeId: 999,
        });

        assert.equal(outcome.status, 'place_mismatch');
    });

    it('Teste 6: hospedin_reservation_id duplicado em duas ReservaSuite → ambiguous_suite_id', async () => {
        stubFindAll([]);
        stubSuiteFindAll([
            {
                id: 170,
                idReservaHospedagem: 168,
                idEventoSuite: 5,
                hospedinReservationId: '30665539',
            },
            {
                id: 180,
                idReservaHospedagem: 168,
                idEventoSuite: 6,
                hospedinReservationId: '30665539',
            },
        ]);

        const outcome = await resolveHospedinReservaHospedagemMatch({
            reservationId: '30665539',
            placeId: 501,
        });

        assert.equal(outcome.status, 'ambiguous_suite_id');
    });

    it('Teste 7: ReservaSuite sem pai válido → orphan_suite', async () => {
        stubFindAll([]);
        stubSuiteFindAll([
            {
                id: 170,
                idReservaHospedagem: 168,
                idEventoSuite: 5,
                hospedinReservationId: '30665539',
            },
        ]);
        stubHospedagemFindByPk(null, true);

        const outcome = await resolveHospedinReservaHospedagemMatch({
            reservationId: '30665539',
            placeId: 501,
        });

        assert.equal(outcome.status, 'orphan_suite');
    });

    it('Teste 8: match 1:1 no cabeçalho preservado (prioridade sobre ReservaSuite)', async () => {
        stubFindAll([
            {
                id: 168,
                origemReserva: 'ATENDENTE',
                idExterno: '30665538',
                codigoExterno: 'HO:001414',
            },
        ]);
        const suiteFind = stubSuiteFindAll([]);

        const outcome = await resolveHospedinReservaHospedagemMatch({
            reservationId: '30665538',
            searchableCode: 'HO:001414',
            placeId: 500,
        });

        assert.equal(outcome.status, 'matched');
        if (outcome.status !== 'matched') return;
        assert.equal(outcome.match.matchedBy, 'id_externo');
        assert.equal(outcome.match.idReservaHospedagem, 168);
        assert.equal(suiteFind.mock.callCount(), 0);
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
        stubSuiteFindAll([]);

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

    it('Teste 9: origem ATENDENTE multi-suíte via ReservaSuite → linkOnly true', async () => {
        setupMultiSuiteLine(MULTI_SUITE.lines[0]);

        const result = await resolveExistingReservationLink({
            reservationId: 30665539,
            payload: {
                place_id: MULTI_SUITE.lines[0].placeId,
                searchable_code: 'HO:001414',
            },
        });

        assert.ok(result);
        assert.equal(result?.linkOnly, true);
        assert.equal(result?.idReservaHospedagem, 168);
        assert.equal(result?.matchedBy, 'hospedin_reservation_id');
    });

    it('Teste 10: paridade resolveHospedinReservaHospedagemMatch e resolveExistingReservationLink', async () => {
        for (const line of MULTI_SUITE.lines) {
            mock.restoreAll();
            setupMultiSuiteLine(line);

            const outcome = await resolveHospedinReservaHospedagemMatch({
                reservationId: line.reservationId,
                placeId: line.placeId,
            });
            const link = await resolveExistingReservationLink({
                reservationId: Number(line.reservationId),
                payload: { place_id: line.placeId },
            });

            assert.equal(outcome.status, 'matched');
            assert.ok(link);
            if (outcome.status !== 'matched' || !link) continue;
            assert.equal(
                link.idReservaHospedagem,
                outcome.match.idReservaHospedagem
            );
            assert.equal(link.matchedBy, outcome.match.matchedBy);
            assert.equal(link.linkOnly, true);
        }
    });
});
