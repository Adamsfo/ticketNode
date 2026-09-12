/**
 * Testes — reconciliação de idUsuario em UPDATE Hospedin.
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/integrations/hospedin/services/GuestUsuarioRelinkService.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GuestResolveResult } from '../../../services/GuestResolverService';
import {
    pickTitularIdUsuario,
    relinkHospedesFromDesired,
    resolveCpfForHospedeRelink,
    shouldRelinkHospedeUsuario,
    shouldUpdateTitularUsuario,
    type HospedeRowLike,
} from './GuestUsuarioRelinkService';

const TECH_ID = 9001;
const REAL_ID = 42;
const OTHER_REAL_ID = 77;
const CPF_A = '529.982.247-25';
const CPF_B = '390.533.447-05';

const isTech = (id: number) => id === TECH_ID;

function resolved(
    partial: Partial<GuestResolveResult> &
        Pick<GuestResolveResult, 'idUsuario' | 'action' | 'isTechnical'>
): GuestResolveResult {
    return {
        cpf: partial.cpf ?? null,
        nome: partial.nome || 'Hóspede',
        message: partial.message || '',
        ...partial,
    };
}

function fakeRow(id: number, idUsuario: number | null): HospedeRowLike {
    const row: HospedeRowLike = {
        id,
        nome: 'Maria',
        tipo: 'Adulto',
        idUsuario,
        async update(values: { idUsuario: number }) {
            row.idUsuario = values.idUsuario;
        },
    };
    return row;
}

describe('shouldRelinkHospedeUsuario', () => {
    it('CREATE sem CPF → técnico; sem mudança se já técnico', () => {
        assert.equal(
            shouldRelinkHospedeUsuario(
                TECH_ID,
                resolved({
                    idUsuario: TECH_ID,
                    action: 'TECHNICAL_CPF_MISSING',
                    isTechnical: true,
                })
            ),
            false
        );
    });

    it('UPDATE adicionando CPF → troca técnico → real', () => {
        assert.equal(
            shouldRelinkHospedeUsuario(
                TECH_ID,
                resolved({
                    idUsuario: REAL_ID,
                    action: 'UPGRADED_FROM_TECHNICAL',
                    isTechnical: false,
                    cpf: CPF_A,
                })
            ),
            true
        );
    });

    it('UPDATE mantendo mesmo CPF → sem alteração', () => {
        assert.equal(
            shouldRelinkHospedeUsuario(
                REAL_ID,
                resolved({
                    idUsuario: REAL_ID,
                    action: 'REUSED_BY_CPF',
                    isTechnical: false,
                    cpf: CPF_A,
                })
            ),
            false
        );
    });

    it('UPDATE trocando hóspede (CPF diferente) → troca idUsuario', () => {
        assert.equal(
            shouldRelinkHospedeUsuario(
                REAL_ID,
                resolved({
                    idUsuario: OTHER_REAL_ID,
                    action: 'CREATED',
                    isTechnical: false,
                    cpf: CPF_B,
                })
            ),
            true
        );
    });

    it('origem sem CPF → não faz downgrade de cliente real para técnico', () => {
        assert.equal(
            shouldRelinkHospedeUsuario(
                REAL_ID,
                resolved({
                    idUsuario: TECH_ID,
                    action: 'TECHNICAL_CPF_MISSING',
                    isTechnical: true,
                }),
                { isTechnicalUserId: isTech }
            ),
            false
        );
    });

    it('origem sem CPF + vínculo técnico → sem mudança se já técnico', () => {
        assert.equal(
            shouldRelinkHospedeUsuario(
                TECH_ID,
                resolved({
                    idUsuario: TECH_ID,
                    action: 'TECHNICAL_CPF_MISSING',
                    isTechnical: true,
                }),
                { isTechnicalUserId: isTech }
            ),
            false
        );
    });
});

describe('shouldUpdateTitularUsuario', () => {
    it('não regride titular real para técnico', () => {
        assert.equal(
            shouldUpdateTitularUsuario(REAL_ID, TECH_ID, isTech),
            false
        );
    });

    it('permite upgrade de titular técnico para real', () => {
        assert.equal(
            shouldUpdateTitularUsuario(TECH_ID, REAL_ID, isTech),
            true
        );
    });

    it('idempotente quando titular já é o mesmo', () => {
        assert.equal(
            shouldUpdateTitularUsuario(REAL_ID, REAL_ID, isTech),
            false
        );
    });
});

describe('resolveCpfForHospedeRelink', () => {
    it('usa CPF do payload', () => {
        assert.equal(
            resolveCpfForHospedeRelink({ desiredCpf: CPF_A }),
            CPF_A
        );
    });

    it('usa CPF dos documentos quando payload vazio', () => {
        assert.equal(
            resolveCpfForHospedeRelink({
                desiredCpf: null,
                documents: [
                    { tipo: 'IDENTIFICATION', numero: '52998224725' },
                ],
            }),
            CPF_A
        );
    });

    it('sem documento válido → null (mantém técnico)', () => {
        assert.equal(
            resolveCpfForHospedeRelink({
                desiredCpf: null,
                documents: [{ tipo: 'PASSPORT', numero: 'AB123' }],
            }),
            null
        );
    });
});

describe('relinkHospedesFromDesired — fluxos UPDATE', () => {
    it('CREATE sem CPF: resolve técnico e não cria usuário real', async () => {
        const row = fakeRow(1, null);
        let resolvedCalls = 0;
        const technicalStillExists = { [TECH_ID]: true };

        const changes = await relinkHospedesFromDesired({
            rows: [row],
            desiredGuests: [
                {
                    nome: 'Maria',
                    tipo: 'Adulto',
                    cpf: null,
                },
            ],
            deps: {
                guestResolverService: {
                    clearCache() {},
                    async resolveGuest() {
                        resolvedCalls += 1;
                        return resolved({
                            idUsuario: TECH_ID,
                            action: 'TECHNICAL_CPF_MISSING',
                            isTechnical: true,
                        });
                    },
                },
                loadDocumentos: async () => [],
                currentHospedagemIdUsuario: TECH_ID,
                updateHospedagemUsuario: async () => undefined,
            },
        });

        assert.equal(resolvedCalls, 1);
        assert.equal(Number(row.idUsuario), TECH_ID);
        assert.ok(technicalStillExists[TECH_ID], 'técnico permanece cadastrado');
        assert.ok(changes.some((c) => c.field === 'hospede.idUsuario'));
    });

    it('UPDATE adicionando CPF: desvincula técnico e aponta para usuário real', async () => {
        const row = fakeRow(1, TECH_ID);
        let hospedagemUsuario = TECH_ID;
        const users = new Set([TECH_ID]);

        const changes = await relinkHospedesFromDesired({
            rows: [row],
            desiredGuests: [
                {
                    nome: 'Maria',
                    tipo: 'Adulto',
                    cpf: CPF_A,
                },
            ],
            deps: {
                guestResolverService: {
                    clearCache() {},
                    async resolveGuest(input) {
                        assert.equal(input.cpf, CPF_A);
                        users.add(REAL_ID);
                        return resolved({
                            idUsuario: REAL_ID,
                            action: 'UPGRADED_FROM_TECHNICAL',
                            isTechnical: false,
                            cpf: CPF_A,
                        });
                    },
                },
                loadDocumentos: async () => [],
                currentHospedagemIdUsuario: hospedagemUsuario,
                updateHospedagemUsuario: async (id) => {
                    hospedagemUsuario = id;
                },
            },
        });

        assert.equal(Number(row.idUsuario), REAL_ID);
        assert.equal(hospedagemUsuario, REAL_ID);
        assert.ok(users.has(TECH_ID), 'técnico NÃO foi excluído');
        assert.ok(
            changes.some(
                (c) =>
                    c.field === 'hospede.idUsuario' &&
                    c.before === TECH_ID &&
                    c.after === REAL_ID
            )
        );
        assert.ok(
            changes.some(
                (c) =>
                    c.field === 'hospedagem.idUsuario' && c.after === REAL_ID
            )
        );
    });

    it('UPDATE trocando hóspede (CPF B): troca idUsuario', async () => {
        const row = fakeRow(1, REAL_ID);

        await relinkHospedesFromDesired({
            rows: [row],
            desiredGuests: [
                {
                    nome: 'João',
                    tipo: 'Adulto',
                    cpf: CPF_B,
                },
            ],
            deps: {
                guestResolverService: {
                    clearCache() {},
                    async resolveGuest(input) {
                        assert.equal(input.cpf, CPF_B);
                        return resolved({
                            idUsuario: OTHER_REAL_ID,
                            action: 'CREATED',
                            isTechnical: false,
                            cpf: CPF_B,
                        });
                    },
                },
                loadDocumentos: async () => [],
                currentHospedagemIdUsuario: REAL_ID,
                updateHospedagemUsuario: async () => undefined,
            },
        });

        assert.equal(Number(row.idUsuario), OTHER_REAL_ID);
    });

    it('UPDATE mantendo mesmo CPF: idempotente (sem changes de hospede)', async () => {
        const row = fakeRow(1, REAL_ID);
        let updateHospedagemCalls = 0;

        const changes = await relinkHospedesFromDesired({
            rows: [row],
            desiredGuests: [
                {
                    nome: 'Maria',
                    tipo: 'Adulto',
                    cpf: CPF_A,
                },
            ],
            deps: {
                guestResolverService: {
                    clearCache() {},
                    async resolveGuest() {
                        return resolved({
                            idUsuario: REAL_ID,
                            action: 'REUSED_BY_CPF',
                            isTechnical: false,
                            cpf: CPF_A,
                        });
                    },
                },
                loadDocumentos: async () => [
                    { tipo: 'CPF', numero: CPF_A },
                ],
                currentHospedagemIdUsuario: REAL_ID,
                updateHospedagemUsuario: async () => {
                    updateHospedagemCalls += 1;
                },
            },
        });

        assert.equal(Number(row.idUsuario), REAL_ID);
        assert.equal(
            changes.filter((c) => c.field === 'hospede.idUsuario').length,
            0
        );
        assert.equal(updateHospedagemCalls, 0);
    });

    it('cliente real vinculado + origem sem CPF → mantém cliente real no hóspede', async () => {
        const row = fakeRow(1, REAL_ID);
        let usuarioUpdateCalls = 0;

        const changes = await relinkHospedesFromDesired({
            rows: [row],
            desiredGuests: [
                {
                    nome: 'João',
                    tipo: 'Adulto',
                    cpf: null,
                },
            ],
            deps: {
                guestResolverService: {
                    clearCache() {},
                    async resolveGuest() {
                        return resolved({
                            idUsuario: TECH_ID,
                            action: 'TECHNICAL_CPF_MISSING',
                            isTechnical: true,
                        });
                    },
                },
                loadDocumentos: async () => [],
                currentHospedagemIdUsuario: REAL_ID,
                isTechnicalUserId: isTech,
                updateHospedagemUsuario: async () => {
                    usuarioUpdateCalls += 1;
                },
            },
        });

        assert.equal(Number(row.idUsuario), REAL_ID);
        assert.equal(
            changes.filter((c) => c.field === 'hospede.idUsuario').length,
            0
        );
        assert.equal(usuarioUpdateCalls, 0);
    });

    it('titular real + origem sem CPF → mantém titular real', async () => {
        const row = fakeRow(1, TECH_ID);
        let hospedagemUsuario = REAL_ID;

        const changes = await relinkHospedesFromDesired({
            rows: [row],
            desiredGuests: [
                {
                    nome: 'Maria',
                    tipo: 'Adulto',
                    cpf: null,
                },
            ],
            deps: {
                guestResolverService: {
                    clearCache() {},
                    async resolveGuest() {
                        return resolved({
                            idUsuario: TECH_ID,
                            action: 'TECHNICAL_CPF_MISSING',
                            isTechnical: true,
                        });
                    },
                },
                loadDocumentos: async () => [],
                currentHospedagemIdUsuario: REAL_ID,
                isTechnicalUserId: isTech,
                updateHospedagemUsuario: async (id) => {
                    hospedagemUsuario = id;
                },
            },
        });

        assert.equal(hospedagemUsuario, REAL_ID);
        assert.equal(
            changes.filter((c) => c.field === 'hospedagem.idUsuario').length,
            0
        );
    });

    it('usuário técnico + origem sem CPF → continua técnico', async () => {
        const row = fakeRow(1, TECH_ID);

        await relinkHospedesFromDesired({
            rows: [row],
            desiredGuests: [
                {
                    nome: 'Maria',
                    tipo: 'Adulto',
                    cpf: null,
                },
            ],
            deps: {
                guestResolverService: {
                    clearCache() {},
                    async resolveGuest() {
                        return resolved({
                            idUsuario: TECH_ID,
                            action: 'TECHNICAL_CPF_MISSING',
                            isTechnical: true,
                        });
                    },
                },
                loadDocumentos: async () => [],
                currentHospedagemIdUsuario: TECH_ID,
                isTechnicalUserId: isTech,
                updateHospedagemUsuario: async () => undefined,
            },
        });

        assert.equal(Number(row.idUsuario), TECH_ID);
    });

    it('origem sem CPF não invoca alteração de cadastro Usuario (só relink)', async () => {
        const row = fakeRow(1, REAL_ID);
        let resolveInputCpf: string | null | undefined = 'unset';

        await relinkHospedesFromDesired({
            rows: [row],
            desiredGuests: [{ nome: 'João', tipo: 'Adulto', cpf: null }],
            deps: {
                guestResolverService: {
                    clearCache() {},
                    async resolveGuest(input) {
                        resolveInputCpf = input.cpf;
                        return resolved({
                            idUsuario: TECH_ID,
                            action: 'TECHNICAL_CPF_MISSING',
                            isTechnical: true,
                        });
                    },
                },
                loadDocumentos: async () => [],
                currentHospedagemIdUsuario: REAL_ID,
                isTechnicalUserId: isTech,
                updateHospedagemUsuario: async () => undefined,
            },
        });

        assert.equal(resolveInputCpf, null);
        assert.equal(Number(row.idUsuario), REAL_ID);
    });

    it('múltiplas sincronizações: resolve pelo CPF (sem duplicar usuário)', async () => {
        const row = fakeRow(1, TECH_ID);
        const createdByCpf = new Map<string, number>();
        createdByCpf.set(CPF_A.replace(/\D/g, ''), REAL_ID);

        const runOnce = async () =>
            relinkHospedesFromDesired({
                rows: [row],
                desiredGuests: [
                    { nome: 'Maria', tipo: 'Adulto', cpf: CPF_A },
                ],
                deps: {
                    guestResolverService: {
                        clearCache() {},
                        async resolveGuest(input) {
                            const digits = String(input.cpf || '').replace(
                                /\D/g,
                                ''
                            );
                            const existing = createdByCpf.get(digits);
                            if (existing) {
                                return resolved({
                                    idUsuario: existing,
                                    action: 'REUSED_BY_CPF',
                                    isTechnical: false,
                                    cpf: input.cpf || null,
                                });
                            }
                            const id = 1000 + createdByCpf.size;
                            createdByCpf.set(digits, id);
                            return resolved({
                                idUsuario: id,
                                action: 'CREATED',
                                isTechnical: false,
                                cpf: input.cpf || null,
                            });
                        },
                    },
                    loadDocumentos: async () => [],
                    currentHospedagemIdUsuario: Number(row.idUsuario),
                    updateHospedagemUsuario: async () => undefined,
                },
            });

        await runOnce();
        await runOnce();
        await runOnce();

        assert.equal(createdByCpf.size, 1);
        assert.equal(Number(row.idUsuario), REAL_ID);
    });
});

describe('pickTitularIdUsuario', () => {
    it('prefere adulto não-técnico', () => {
        assert.equal(
            pickTitularIdUsuario([
                { tipo: 'Adulto', idUsuario: TECH_ID, isTechnical: true },
                { tipo: 'Adulto', idUsuario: REAL_ID, isTechnical: false },
            ]),
            REAL_ID
        );
    });
});
