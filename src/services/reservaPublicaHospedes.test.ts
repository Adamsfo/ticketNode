/**
 * Testes — hóspedes no link público /reserva/:token
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/services/reservaPublicaHospedes.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TipoReservaHospede } from '../models/ReservaHospede';
import { StatusReservaHospedagem } from '../models/ReservaHospedagem';
import { CustomError } from '../utils/customError';
import {
    assertReservaEditavelPorLink,
    assertUsuarioDonoReservaPublica,
    prepararAtualizacaoHospedesReservaPublica,
    serializarSuitesReservaPublica,
} from './reservaSuiteService';

function criarSuitePersistida(params: {
    id?: number;
    idEventoSuite?: number;
    adultos: number;
    criancas: number;
    hospedes: Array<{
        id: number;
        nome: string;
        tipo: TipoReservaHospede;
        dataNascimento?: string | null;
    }>;
}) {
    return {
        id: params.id ?? 1,
        idEventoSuite: params.idEventoSuite ?? 10,
        adultos: params.adultos,
        criancas: params.criancas,
        preco: 100,
        taxaServico: 10,
        valorTotal: 110,
        ReservaHospede: params.hospedes.map((hospede) => ({
            id: hospede.id,
            idReservaSuite: params.id ?? 1,
            nome: hospede.nome,
            tipo: hospede.tipo,
            dataNascimento: hospede.dataNascimento ?? null,
        })),
    };
}

describe('serializarSuitesReservaPublica', () => {
    it('retorna hóspedes por suíte com id, nome, tipo e dataNascimento', () => {
        const suites = serializarSuitesReservaPublica([
            criarSuitePersistida({
                id: 5,
                adultos: 2,
                criancas: 0,
                hospedes: [
                    { id: 11, nome: 'Ana', tipo: TipoReservaHospede.Adulto },
                    { id: 12, nome: '', tipo: TipoReservaHospede.Adulto },
                ],
            }) as any,
        ]);

        assert.equal(suites.length, 1);
        assert.equal(suites[0].idReservaSuite, 5);
        assert.equal(suites[0].hospedes.length, 2);
        assert.equal(suites[0].hospedes[0].nome, 'Ana');
        assert.equal(suites[0].hospedes[0].tipo, TipoReservaHospede.Adulto);
    });
});

describe('prepararAtualizacaoHospedesReservaPublica', () => {
    it('atualiza nomes dos hóspedes da própria reserva', () => {
        const suitesDb = [
            criarSuitePersistida({
                id: 1,
                adultos: 2,
                criancas: 0,
                hospedes: [
                    { id: 101, nome: '', tipo: TipoReservaHospede.Adulto },
                    { id: 102, nome: '', tipo: TipoReservaHospede.Adulto },
                ],
            }),
        ];

        const updates = prepararAtualizacaoHospedesReservaPublica(suitesDb, [
            {
                idReservaSuite: 1,
                hospedes: [
                    { id: 101, nome: 'Maria Silva' },
                    { id: 102, nome: 'João Silva' },
                ],
            },
        ]);

        assert.equal(updates.length, 2);
        assert.deepEqual(updates[0], {
            id: 101,
            nome: 'Maria Silva',
            dataNascimento: null,
        });
    });

    it('rejeita hóspede de outra suíte/reserva', () => {
        const suitesDb = [
            criarSuitePersistida({
                id: 1,
                adultos: 1,
                criancas: 0,
                hospedes: [{ id: 101, nome: '', tipo: TipoReservaHospede.Adulto }],
            }),
        ];

        assert.throws(
            () =>
                prepararAtualizacaoHospedesReservaPublica(suitesDb, [
                    {
                        idReservaSuite: 1,
                        hospedes: [{ id: 999, nome: 'Inválido' }],
                    },
                ]),
            (err: unknown) =>
                err instanceof CustomError &&
                String(err.message).includes('não pertence')
        );
    });

    it('rejeita adulto sem nome', () => {
        const suitesDb = [
            criarSuitePersistida({
                id: 1,
                adultos: 1,
                criancas: 0,
                hospedes: [{ id: 101, nome: '', tipo: TipoReservaHospede.Adulto }],
            }),
        ];

        assert.throws(
            () =>
                prepararAtualizacaoHospedesReservaPublica(suitesDb, [
                    {
                        idReservaSuite: 1,
                        hospedes: [{ id: 101, nome: '   ' }],
                    },
                ]),
            (err: unknown) =>
                err instanceof CustomError &&
                String(err.message).includes('Nome do hóspede é obrigatório')
        );
    });

    it('rejeita criança sem data de nascimento', () => {
        const suitesDb = [
            criarSuitePersistida({
                id: 1,
                adultos: 0,
                criancas: 1,
                hospedes: [
                    {
                        id: 201,
                        nome: '',
                        tipo: TipoReservaHospede.Crianca,
                        dataNascimento: null,
                    },
                ],
            }),
        ];

        assert.throws(
            () =>
                prepararAtualizacaoHospedesReservaPublica(suitesDb, [
                    {
                        idReservaSuite: 1,
                        hospedes: [{ id: 201, nome: 'Pedrinho' }],
                    },
                ]),
            (err: unknown) =>
                err instanceof CustomError &&
                String(err.message).includes('Data de nascimento é obrigatória')
        );
    });

    it('não altera a quantidade de hóspedes exigida', () => {
        const suitesDb = [
            criarSuitePersistida({
                id: 1,
                adultos: 2,
                criancas: 0,
                hospedes: [
                    { id: 101, nome: '', tipo: TipoReservaHospede.Adulto },
                    { id: 102, nome: '', tipo: TipoReservaHospede.Adulto },
                ],
            }),
        ];

        assert.throws(
            () =>
                prepararAtualizacaoHospedesReservaPublica(suitesDb, [
                    {
                        idReservaSuite: 1,
                        hospedes: [{ id: 101, nome: 'Somente um' }],
                    },
                ]),
            (err: unknown) =>
                err instanceof CustomError &&
                String(err.message).includes('Informe todos os hóspedes')
        );
    });
});

describe('assertUsuarioDonoReservaPublica', () => {
    it('rejeita usuário autenticado diferente do dono da reserva', () => {
        assert.throws(
            () => assertUsuarioDonoReservaPublica({ idUsuario: 10 }, 99),
            (err: unknown) =>
                err instanceof CustomError &&
                err.statusCode === 403 &&
                String(err.message).includes('Sem permissão')
        );
    });

    it('aceita o dono da reserva', () => {
        assert.doesNotThrow(() =>
            assertUsuarioDonoReservaPublica({ idUsuario: 10 }, 10)
        );
    });
});

describe('assertReservaEditavelPorLink', () => {
    it('rejeita reserva expirada', async () => {
        await assert.rejects(
            () =>
                assertReservaEditavelPorLink({
                    status: StatusReservaHospedagem.Expirada,
                    tokenPagamento: 'x',
                    expiraEm: new Date('2020-01-01'),
                    createdAt: new Date('2020-01-01'),
                } as any),
            (err: unknown) =>
                err instanceof CustomError &&
                String(err.message).includes('expirada')
        );
    });

    it('rejeita reserva que não está aguardando pagamento', async () => {
        await assert.rejects(
            () =>
                assertReservaEditavelPorLink({
                    status: StatusReservaHospedagem.Confirmada,
                    tokenPagamento: 'x',
                    expiraEm: new Date(Date.now() + 60_000),
                    createdAt: new Date(),
                } as any),
            (err: unknown) =>
                err instanceof CustomError &&
                String(err.message).includes('não está disponível')
        );
    });
});
