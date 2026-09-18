/**
 * node --require ts-node/register/transpile-only --test \
 *   src/services/minhasReservasService.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { StatusReservaHospedagem } from '../models/ReservaHospedagem';
import { CustomError } from '../utils/customError';
import {
    listarMinhasReservas,
    mapearMinhaReservaCard,
    mapearMinhaReservaDetalhe,
    obterMinhaReservaDetalhe,
    parseFiltroStatusMinhasReservas,
    resolverSituacaoFinanceiraMinhaReserva,
    statusBancoPorFiltroMinhasReservas,
} from './minhasReservasService';
import { assertUsuarioDonoReservaPublica } from './reservaSuiteService';

describe('parseFiltroStatusMinhasReservas', () => {
    it('aceita confirmadas, hospedadas e canceladas', () => {
        assert.equal(parseFiltroStatusMinhasReservas('confirmadas'), 'confirmadas');
        assert.equal(parseFiltroStatusMinhasReservas('Hospedadas'), 'hospedadas');
        assert.equal(parseFiltroStatusMinhasReservas('canceladas'), 'canceladas');
    });

    it('usa confirmadas como padrão', () => {
        assert.equal(parseFiltroStatusMinhasReservas(undefined), 'confirmadas');
    });

    it('rejeita status inválido', () => {
        assert.throws(
            () => parseFiltroStatusMinhasReservas('finalizadas'),
            (err: unknown) =>
                err instanceof CustomError && err.statusCode === 400
        );
    });
});

describe('statusBancoPorFiltroMinhasReservas', () => {
    it('mapeia filtros para status do banco', () => {
        assert.equal(
            statusBancoPorFiltroMinhasReservas('confirmadas'),
            StatusReservaHospedagem.Confirmada
        );
        assert.equal(
            statusBancoPorFiltroMinhasReservas('hospedadas'),
            StatusReservaHospedagem.Hospedada
        );
        assert.equal(
            statusBancoPorFiltroMinhasReservas('canceladas'),
            StatusReservaHospedagem.Cancelada
        );
    });
});

describe('mapearMinhaReservaCard', () => {
    it('monta DTO com suítes, hóspedes e financeiro', () => {
        const dto = mapearMinhaReservaCard(
            {
                id: 42,
                status: StatusReservaHospedagem.Confirmada,
                checkin: new Date('2026-12-01T14:00:00.000Z'),
                checkout: new Date('2026-12-03T12:00:00.000Z'),
                noites: 2,
                valorTotal: 500,
                valorPago: 200,
                saldoPendente: 300,
                origemReserva: 'CLIENTE',
                tokenPagamento: null,
                dataConfirmacao: new Date('2026-09-20T10:00:00.000Z'),
                createdAt: new Date('2026-09-19T10:00:00.000Z'),
                Evento: { id: 7, nome: 'Pousada Azaleia' },
                ReservaSuite: [
                    {
                        id: 1,
                        idEventoSuite: 3,
                        adultos: 2,
                        criancas: 1,
                        EventoSuite: { id: 3, nome: 'Suíte Master' },
                    } as any,
                ],
            } as any,
            [
                {
                    id: 1,
                    valor: 200,
                    formaPagamento: 'PIX',
                    comprovante: '12345678901',
                },
            ]
        );

        assert.equal(dto.id, 42);
        assert.equal(dto.numeroReserva, 42);
        assert.equal(dto.status, 'Confirmada');
        assert.equal(dto.evento?.nome, 'Pousada Azaleia');
        assert.equal(dto.nomeSuite, 'Suíte Master');
        assert.equal(dto.adultos, 2);
        assert.equal(dto.criancas, 1);
        assert.equal(dto.noites, 2);
        assert.equal(dto.valorTotal, 500);
        assert.equal(dto.valorPago, 200);
        assert.equal(dto.saldoPendente, 300);
        assert.equal(dto.podeCancelar, true);
        assert.equal(dto.percentualDevolucao, 100);
        assert.equal(dto.valorDevolucao, 200);
    });
});

describe('resolverSituacaoFinanceiraMinhaReserva', () => {
    it('classifica quitada, parcial e pendente', () => {
        assert.equal(
            resolverSituacaoFinanceiraMinhaReserva(100, 100, 0),
            'Quitada'
        );
        assert.equal(
            resolverSituacaoFinanceiraMinhaReserva(100, 40, 60),
            'Parcial'
        );
        assert.equal(
            resolverSituacaoFinanceiraMinhaReserva(100, 0, 100),
            'Pendente'
        );
    });
});

describe('mapearMinhaReservaDetalhe', () => {
    it('monta DTO com suítes, hóspedes, financeiro e pagamento pendente', () => {
        const dto = mapearMinhaReservaDetalhe({
            id: 77,
            idEvento: 5,
            status: StatusReservaHospedagem.AguardandoPagamento,
            checkin: new Date('2026-11-01T14:00:00.000Z'),
            checkout: new Date('2026-11-03T12:00:00.000Z'),
            noites: 2,
            preco: 400,
            taxaServico: 40,
            valorTotal: 440,
            valorPago: 0,
            saldoPendente: 440,
            tokenPagamento: 'token-opaco-valido-123456',
            dataConfirmacao: null,
            createdAt: new Date('2026-10-01T10:00:00.000Z'),
            Evento: { id: 5, nome: 'Pousada Teste', imagem: '/img.jpg' },
            ReservaSuite: [
                {
                    id: 9,
                    idEventoSuite: 2,
                    adultos: 2,
                    criancas: 0,
                    EventoSuite: { id: 2, nome: 'Suíte Luxo' },
                    ReservaHospede: [
                        {
                            nome: 'Maria',
                            tipo: 'Adulto',
                            dataNascimento: null,
                        },
                    ],
                } as any,
            ],
        } as any);

        assert.equal(dto.numeroReserva, 77);
        assert.equal(dto.evento.nome, 'Pousada Teste');
        assert.equal(dto.suites.length, 1);
        assert.equal(dto.suites[0].hospedes[0].nome, 'Maria');
        assert.equal(dto.financeiro.valorTotal, 440);
        assert.equal(dto.financeiro.situacaoFinanceira, 'Pendente');
        assert.equal(dto.podeContinuarPagamento, true);
        assert.equal(dto.tokenPagamento, 'token-opaco-valido-123456');
    });

    it('não expõe token quando reserva confirmada', () => {
        const dto = mapearMinhaReservaDetalhe({
            id: 1,
            idEvento: 1,
            status: StatusReservaHospedagem.Confirmada,
            checkin: new Date(),
            checkout: new Date(),
            noites: 1,
            preco: 100,
            taxaServico: 10,
            valorTotal: 110,
            valorPago: 110,
            saldoPendente: 0,
            tokenPagamento: 'token-antigo',
            Evento: { id: 1, nome: 'Pousada' },
            ReservaSuite: [],
        } as any);

        assert.equal(dto.podeContinuarPagamento, false);
        assert.equal(dto.tokenPagamento, null);
    });
});

describe('obterMinhaReservaDetalhe', () => {
    it('retorna detalhe para o dono da reserva', async () => {
        const { ReservaHospedagem } = await import('../models/ReservaHospedagem');
        const { PagamentoHospedagem } = await import('../models/PagamentoHospedagem');
        const reservaMock = {
            id: 15,
            idUsuario: 8,
            idEvento: 3,
            status: StatusReservaHospedagem.Confirmada,
            checkin: new Date('2026-12-01T14:00:00.000Z'),
            checkout: new Date('2026-12-03T12:00:00.000Z'),
            noites: 2,
            preco: 300,
            taxaServico: 30,
            valorTotal: 330,
            valorPago: 330,
            saldoPendente: 0,
            tokenPagamento: null,
            dataConfirmacao: new Date('2026-11-20T10:00:00.000Z'),
            createdAt: new Date('2026-11-19T10:00:00.000Z'),
            Evento: { id: 3, nome: 'Pousada Azaleia', imagem: null },
            ReservaSuite: [],
        };

        const findOne = mock.fn(async () => reservaMock);
        const findAllPagamentos = mock.fn(async () => []);
        const originalFindOne = ReservaHospedagem.findOne;
        const originalFindAllPagamentos = PagamentoHospedagem.findAll;
        ReservaHospedagem.findOne = findOne as any;
        PagamentoHospedagem.findAll = findAllPagamentos as any;

        try {
            const detalhe = await obterMinhaReservaDetalhe(15, 8);
            assert.equal(detalhe.id, 15);
            assert.equal(detalhe.status, 'Confirmada');
            assert.equal(detalhe.financeiro.situacaoFinanceira, 'Quitada');
        } finally {
            ReservaHospedagem.findOne = originalFindOne;
            PagamentoHospedagem.findAll = originalFindAllPagamentos;
        }
    });

    it('rejeita usuário diferente do dono', async () => {
        const { ReservaHospedagem } = await import('../models/ReservaHospedagem');
        const findOne = mock.fn(async () => ({
            id: 15,
            idUsuario: 8,
            status: StatusReservaHospedagem.Confirmada,
        }));
        const original = ReservaHospedagem.findOne;
        ReservaHospedagem.findOne = findOne as any;

        try {
            await assert.rejects(
                () => obterMinhaReservaDetalhe(15, 99),
                (err: unknown) =>
                    err instanceof CustomError && err.statusCode === 403
            );
        } finally {
            ReservaHospedagem.findOne = original;
        }
    });

    it('retorna 404 para reserva inexistente', async () => {
        const { ReservaHospedagem } = await import('../models/ReservaHospedagem');
        const findOne = mock.fn(async () => null);
        const original = ReservaHospedagem.findOne;
        ReservaHospedagem.findOne = findOne as any;

        try {
            await assert.rejects(
                () => obterMinhaReservaDetalhe(999, 8),
                (err: unknown) =>
                    err instanceof CustomError && err.statusCode === 404
            );
        } finally {
            ReservaHospedagem.findOne = original;
        }
    });

    it('rejeita usuário não autenticado', async () => {
        await assert.rejects(
            () => obterMinhaReservaDetalhe(1, 0),
            (err: unknown) =>
                err instanceof CustomError && err.statusCode === 401
        );
    });
});

describe('assertUsuarioDonoReservaPublica (integração)', () => {
    it('bloqueia consulta de reserva de outro usuário', () => {
        assert.throws(
            () => assertUsuarioDonoReservaPublica({ idUsuario: 10 }, 11),
            (err: unknown) =>
                err instanceof CustomError && err.statusCode === 403
        );
    });
});

describe('listarMinhasReservas', () => {
    it('filtra por idUsuario e status com paginação', async () => {
        const { ReservaHospedagem } = await import('../models/ReservaHospedagem');
        const { PagamentoHospedagem } = await import('../models/PagamentoHospedagem');
        const findAndCountAll = mock.fn(async () => ({
            rows: [
                {
                    id: 10,
                    status: StatusReservaHospedagem.Hospedada,
                    checkin: new Date('2026-10-01T14:00:00.000Z'),
                    checkout: new Date('2026-10-03T12:00:00.000Z'),
                    noites: 2,
                    valorTotal: 100,
                    valorPago: 100,
                    saldoPendente: 0,
                    origemReserva: 'CLIENTE',
                    dataConfirmacao: null,
                    createdAt: new Date('2026-09-19T10:00:00.000Z'),
                    Evento: { id: 1, nome: 'Pousada' },
                    ReservaSuite: [],
                },
            ],
            count: 25,
        }));

        const findAllPagamentos = mock.fn(async () => []);
        const originalFindAndCountAll = ReservaHospedagem.findAndCountAll;
        const originalFindAllPagamentos = PagamentoHospedagem.findAll;
        ReservaHospedagem.findAndCountAll = findAndCountAll as any;
        PagamentoHospedagem.findAll = findAllPagamentos as any;

        try {
            const resultado = await listarMinhasReservas({
                idUsuario: 99,
                status: 'hospedadas',
                page: 1,
                pageSize: 20,
            });

            assert.equal(resultado.data.length, 1);
            assert.equal(resultado.data[0].status, 'Hospedada');
            assert.equal(resultado.meta.page, 1);
            assert.equal(resultado.meta.pageSize, 20);
            assert.equal(resultado.meta.total, 25);
            assert.equal(resultado.meta.hasMore, true);
            assert.equal(resultado.meta.status, 'hospedadas');

            const call = findAndCountAll.mock.calls[0]?.arguments?.[0] as any;
            assert.equal(call.where.idUsuario, 99);
            assert.equal(call.where.status, StatusReservaHospedagem.Hospedada);
            assert.equal(call.limit, 20);
            assert.equal(call.offset, 0);
        } finally {
            ReservaHospedagem.findAndCountAll = originalFindAndCountAll;
            PagamentoHospedagem.findAll = originalFindAllPagamentos;
        }
    });

    it('retorna lista vazia quando usuário não possui reservas', async () => {
        const { ReservaHospedagem } = await import('../models/ReservaHospedagem');
        const findAndCountAll = mock.fn(async () => ({ rows: [], count: 0 }));
        const original = ReservaHospedagem.findAndCountAll;
        ReservaHospedagem.findAndCountAll = findAndCountAll as any;

        try {
            const resultado = await listarMinhasReservas({
                idUsuario: 5,
                status: 'canceladas',
            });

            assert.deepEqual(resultado.data, []);
            assert.equal(resultado.meta.total, 0);
            assert.equal(resultado.meta.hasMore, false);
        } finally {
            ReservaHospedagem.findAndCountAll = original;
        }
    });

    it('garante isolamento por usuário na query (usuário A ≠ usuário B)', async () => {
        const { ReservaHospedagem } = await import('../models/ReservaHospedagem');
        const findAndCountAll = mock.fn(async () => ({ rows: [], count: 0 }));
        const original = ReservaHospedagem.findAndCountAll;
        ReservaHospedagem.findAndCountAll = findAndCountAll as any;

        try {
            await listarMinhasReservas({ idUsuario: 1, status: 'confirmadas' });
            await listarMinhasReservas({ idUsuario: 2, status: 'confirmadas' });

            const callA = findAndCountAll.mock.calls[0]?.arguments?.[0] as any;
            const callB = findAndCountAll.mock.calls[1]?.arguments?.[0] as any;
            assert.equal(callA.where.idUsuario, 1);
            assert.equal(callB.where.idUsuario, 2);
            assert.notEqual(callA.where.idUsuario, callB.where.idUsuario);
        } finally {
            ReservaHospedagem.findAndCountAll = original;
        }
    });
});
