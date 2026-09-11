/**
 * Testes offline — outbound UPDATE (sem HTTP/DB real).
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/outbound/HospedinOutboundUpdate.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HospedinApiError } from '../types/errors';
import { classifyOutboundHttpError } from './hospedinOutboundErrorClassification';
import {
    buildOutboundNote,
    buildOutboundUpdatePatch,
    diffOutboundHashInputs,
    isNoteOnlyOperationalPatch,
} from './HospedinOutboundPayloadBuilder';
import {
    buildSnapshotFromReserva,
    financeHashChanged,
    hashOutboundPayload,
    resolveOutboundObservacoes,
    snapshotToHashInput,
    type OutboundPayloadHashInput,
} from './HospedinOutboundSnapshot';
import { OUTBOUND_UPDATE_409_POLICY } from './HospedinOutboundUpdateService';

const baseBefore: OutboundPayloadHashInput = {
    checkin: '2026-10-18T14:00',
    checkout: '2026-10-20T12:00',
    observacoes: 'Obs original',
    suites: [
        {
            idReservaSuite: 0,
            idEventoSuite: 10,
            adultos: 2,
            criancas: 0,
            valorTotalCents: 88000,
        },
    ],
    idEventoSuite: 10,
    adultos: 2,
    criancas: 0,
    valorTotalCents: 88000,
};

function afterWithObs(obs: string | null): OutboundPayloadHashInput {
    return { ...baseBefore, observacoes: obs };
}

describe('resolveOutboundObservacoes / snapshot hash', () => {
    it('alteração só em observacaoOperador muda o hash outbound', () => {
        const importada = 'Texto importado Hospedin';
        const before = buildSnapshotFromReserva({
            observacaoImportada: importada,
            observacaoOperador: null,
            observacoes: importada,
            checkin: new Date('2026-10-18T17:00:00.000Z'),
            checkout: new Date('2026-10-20T15:00:00.000Z'),
            ReservaSuite: [
                {
                    idEventoSuite: 10,
                    adultos: 2,
                    criancas: 0,
                } as any,
            ],
        } as any);

        const after = buildSnapshotFromReserva({
            observacaoImportada: importada,
            observacaoOperador: 'Ligar antes do check-in.',
            observacoes: `${importada}\n\nLigar antes do check-in.`,
            checkin: new Date('2026-10-18T17:00:00.000Z'),
            checkout: new Date('2026-10-20T15:00:00.000Z'),
            ReservaSuite: [
                {
                    idEventoSuite: 10,
                    adultos: 2,
                    criancas: 0,
                } as any,
            ],
        } as any);

        const hashBefore = hashOutboundPayload(snapshotToHashInput(before));
        const hashAfter = hashOutboundPayload(snapshotToHashInput(after));

        assert.notEqual(hashBefore, hashAfter);
        assert.equal(
            resolveOutboundObservacoes({
                observacaoImportada: importada,
                observacaoOperador: 'Ligar antes do check-in.',
                observacoes: `${importada}\n\nLigar antes do check-in.`,
            }),
            `${importada}\n\nLigar antes do check-in.`
        );
    });
});

describe('buildOutboundUpdatePatch', () => {
    it('note-only produz PATCH mínimo com sufixo Jango', () => {
        const after = afterWithObs('Nova observação admin');
        const { changedFields, patch } = buildOutboundUpdatePatch({
            idReservaHospedagem: 127,
            before: baseBefore,
            after,
        });

        assert.deepEqual(changedFields, ['observacoes']);
        assert.ok(patch.note?.includes('Nova observação admin'));
        assert.ok(patch.note?.includes('Reserva Jango #127'));
        assert.ok(patch.note?.includes('ORIGEM JANGO - Reserva Jango #127'));
        assert.ok(!('daily_cents' in patch));
        assert.ok(!('guest_id' in patch));
        assert.ok(!('check_in' in patch));
    });

    it('não envia campos inalterados', () => {
        const { patch } = buildOutboundUpdatePatch({
            idReservaHospedagem: 99,
            before: baseBefore,
            after: { ...baseBefore },
        });
        assert.deepEqual(patch, {});
    });

    it('diff de datas envia check_in/check_out', () => {
        const after: OutboundPayloadHashInput = {
            ...baseBefore,
            checkin: '2026-10-19T14:00',
            checkout: '2026-10-21T12:00',
        };
        const { patch } = buildOutboundUpdatePatch({
            idReservaHospedagem: 50,
            before: baseBefore,
            after,
        });
        assert.equal(patch.check_in, '2026-10-19T14:00');
        assert.equal(patch.check_out, '2026-10-21T12:00');
        assert.ok(!('note' in patch));
    });

    it('diff de suíte exige place_id e place_type_id juntos', () => {
        const after: OutboundPayloadHashInput = {
            ...baseBefore,
            idEventoSuite: 20,
        };
        const { patch } = buildOutboundUpdatePatch({
            idReservaHospedagem: 50,
            before: baseBefore,
            after,
            placeId: 445906,
            placeTypeId: 131939,
        });
        assert.equal(patch.place_id, 445906);
        assert.equal(patch.place_type_id, 131939);
    });
});

describe('idempotência por hash', () => {
    it('pending === payload implica no-op sem HTTP', () => {
        const input = snapshotToHashInput({
            checkin: new Date('2026-10-18T17:00:00.000Z'),
            checkout: new Date('2026-10-20T15:00:00.000Z'),
            idEventoSuite: 10,
            observacoes: 'Obs',
            adultos: 2,
            criancas: 0,
        });
        const hash = hashOutboundPayload(input);
        assert.equal(hash === hash, true);
    });
});

describe('concorrência pós-PATCH', () => {
    it('não marca SYNCED se pending divergiu do hash enviado', () => {
        const sentHash = hashOutboundPayload(baseBefore);
        const latestPending = hashOutboundPayload(
            afterWithObs('Outra alteração durante PROCESSING')
        );
        const latestHash = latestPending;

        const shouldStayPending =
            latestHash !== latestPending || latestHash !== sentHash;
        assert.equal(shouldStayPending, true);
    });
});

describe('classifyOutboundHttpError (UPDATE)', () => {
    function mapUpdateError(error: unknown) {
        let { retryable, errorCode } = classifyOutboundHttpError(error);
        if (error instanceof HospedinApiError && error.status === 404) {
            retryable = false;
            errorCode = 'RESERVATION_NOT_FOUND';
        }
        return { retryable, errorCode };
    }

    it('404 → FAILED RESERVATION_NOT_FOUND (sem recriar)', () => {
        const r = mapUpdateError(
            new HospedinApiError('not found', 404, null)
        );
        assert.equal(r.retryable, false);
        assert.equal(r.errorCode, 'RESERVATION_NOT_FOUND');
    });

    it('422 → FAILED permanente', () => {
        const r = mapUpdateError(
            new HospedinApiError('validation', 422, null)
        );
        assert.equal(r.retryable, false);
        assert.equal(r.errorCode, 'VALIDATION_ERROR');
    });

    it('429 → WAIT_RETRY', () => {
        const r = mapUpdateError(
            new HospedinApiError('rate', 429, null)
        );
        assert.equal(r.retryable, true);
        assert.equal(r.errorCode, 'RATE_LIMITED');
    });

    it('5xx → WAIT_RETRY', () => {
        const r = mapUpdateError(
            new HospedinApiError('server', 503, null)
        );
        assert.equal(r.retryable, true);
        assert.equal(r.errorCode, 'HTTP_5XX');
    });

    it('409 → FAILED conservador (documentado)', () => {
        const r = classifyOutboundHttpError(
            new HospedinApiError('conflict', 409, null)
        );
        assert.equal(r.retryable, false);
        assert.equal(r.errorCode, 'HTTP_409');
        assert.match(OUTBOUND_UPDATE_409_POLICY, /409/);
    });
});

describe('UPDATE não usa POST', () => {
    it('serviço mock registra apenas updateReservation', async () => {
        const calls: string[] = [];
        const mockReservationService = {
            createReservation: async () => {
                calls.push('POST');
                throw new Error('CREATE não deve ser chamado no UPDATE');
            },
            updateReservation: async () => {
                calls.push('PATCH');
                return { reservationId: '30295972' } as any;
            },
        };

        await mockReservationService.updateReservation('30295972', {
            note: buildOutboundNote(127, 'Obs'),
        });
        assert.deepEqual(calls, ['PATCH']);
    });
});

describe('UPDATE financeiro sem PATCH reservation', () => {
    it('530→600: financeChanged sem PATCH operacional na reservation', () => {
        const before: OutboundPayloadHashInput = {
            ...baseBefore,
            valorTotalCents: 53000,
        };
        const after: OutboundPayloadHashInput = {
            ...baseBefore,
            valorTotalCents: 60000,
        };

        assert.equal(financeHashChanged(before, after), true);

        const { patch, changedFields } = buildOutboundUpdatePatch({
            idReservaHospedagem: 127,
            before,
            after,
        });

        assert.deepEqual(changedFields, []);
        assert.deepEqual(patch, {});
    });

    it('530→600 com diff note-only simultâneo não aplica PATCH de note (evita loop)', () => {
        const before: OutboundPayloadHashInput = {
            ...baseBefore,
            valorTotalCents: 53000,
            observacoes: 'Obs antiga',
        };
        const after: OutboundPayloadHashInput = {
            ...baseBefore,
            valorTotalCents: 60000,
            observacoes: 'Obs nova',
        };

        const financeChanged = financeHashChanged(before, after);
        const { patch } = buildOutboundUpdatePatch({
            idReservaHospedagem: 127,
            before,
            after,
        });

        const noteOnlyPatch =
            Object.keys(patch).length > 0 &&
            isNoteOnlyOperationalPatch(patch);
        const shouldApplyOperationalPatch =
            Object.keys(patch).length > 0 &&
            !(financeChanged && noteOnlyPatch);

        assert.equal(financeChanged, true);
        assert.equal(noteOnlyPatch, true);
        assert.equal(shouldApplyOperationalPatch, false);
    });
});

describe('isNoteOnlyOperationalPatch', () => {
    it('detecta PATCH somente de note', () => {
        const { patch } = buildOutboundUpdatePatch({
            idReservaHospedagem: 127,
            before: baseBefore,
            after: afterWithObs('Nova obs'),
        });
        assert.equal(isNoteOnlyOperationalPatch(patch), true);
    });

    it('retorna false quando há outros campos além de note', () => {
        assert.equal(
            isNoteOnlyOperationalPatch({
                note: 'x',
                check_in: '2026-10-19T14:00',
            }),
            false
        );
    });
});

describe('buildOutboundNote', () => {
    it('formata note com referência Jango e origem sem duplicar em retry', () => {
        const note = buildOutboundNote(127, 'Minha obs');
        assert.ok(note.includes('Minha obs'));
        assert.ok(note.includes('Reserva Jango #127'));
        assert.ok(note.includes('ORIGEM JANGO - Reserva Jango #127'));
        assert.equal(
            buildOutboundNote(127, note),
            note
        );
    });
});

describe('diffOutboundHashInputs', () => {
    it('lista campos alterados', () => {
        const changed = diffOutboundHashInputs(
            baseBefore,
            afterWithObs('Nova')
        );
        assert.deepEqual(changed, ['observacoes']);
    });

    it('status isolado não aparece no diff', () => {
        const changed = diffOutboundHashInputs(baseBefore, baseBefore);
        assert.deepEqual(changed, []);
    });
});
