import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TipoAcesso } from '../models/Produtor';
import {
    aplicarTaxasAdicionaisCheckout,
    somarValorTaxasAdicionais,
} from './reservaSuiteFinanceiroService';
import { parseTaxasAdicionaisCheckout } from './reservaSuiteService';
import { ReservaSuite } from '../models/ReservaSuite';
import {
    obterPermissoesTaxasUsuario,
    resolverIdReservaSuitePorEventoSuite,
    resolverPermissoesTaxasAdicionaisReserva,
    validarIdReservaSuiteParaTaxa,
} from './reservaHospedagemTaxaAdicionalService';

describe('reservaHospedagemTaxaAdicional — financeiro checkout', () => {
    const totaisSuites = { preco: 400, taxaServico: 30, valorTotal: 430 };

    it('1. Reserva sem taxa adicional', () => {
        const fin = aplicarTaxasAdicionaisCheckout(totaisSuites, 0);
        assert.equal(fin.valorTotalReserva, 430);
        assert.equal(fin.transacao.preco, 400);
        assert.equal(fin.transacao.taxaServico, 30);
        assert.equal(fin.transacao.valorTotal, 430);
        assert.equal(
            fin.transacao.preco + fin.transacao.taxaServico,
            fin.transacao.valorTotal
        );
    });

    it('2. Uma taxa adicional', () => {
        const fin = aplicarTaxasAdicionaisCheckout(totaisSuites, 150);
        assert.equal(fin.valorTotalReserva, 580);
        assert.equal(fin.transacao.preco, 550);
        assert.equal(fin.transacao.taxaServico, 30);
        assert.equal(fin.transacao.valorTotal, 580);
    });

    it('3. Duas ou mais taxas', () => {
        const totalTaxas = somarValorTaxasAdicionais([
            { valor: 150 },
            { valor: 100 },
        ]);
        assert.equal(totalTaxas, 250);
        const fin = aplicarTaxasAdicionaisCheckout(totaisSuites, totalTaxas);
        assert.equal(fin.valorTotalReserva, 680);
        assert.equal(fin.transacao.preco, 650);
        assert.equal(fin.transacao.taxaServico, 30);
        assert.equal(fin.transacao.valorTotal, 680);
    });

    it('5. Duas suítes + taxa da reserva', () => {
        const suites = { preco: 1700, taxaServico: 100, valorTotal: 1800 };
        const fin = aplicarTaxasAdicionaisCheckout(suites, 200);
        assert.equal(fin.valorTotalReserva, 2000);
        assert.equal(fin.transacao.preco, 1900);
        assert.equal(fin.transacao.taxaServico, 100);
        assert.equal(fin.transacao.valorTotal, 2000);
    });

    it('6. Pagamento parcial — total inclui taxas', () => {
        const fin = aplicarTaxasAdicionaisCheckout(
            { preco: 1800, taxaServico: 200, valorTotal: 2000 },
            300
        );
        assert.equal(fin.valorTotalReserva, 2300);
        const valorRecebido = 2000;
        const saldo = fin.valorTotalReserva - valorRecebido;
        assert.equal(saldo, 300);
        assert.equal(fin.transacao.valorTotal, 2300);
    });

    it('8. Transacao: preco = preço suítes + taxas; taxaServico inalterada', () => {
        const fin = aplicarTaxasAdicionaisCheckout(
            { preco: 700, taxaServico: 100, valorTotal: 800 },
            300
        );
        assert.equal(fin.transacao.preco, 1000);
        assert.equal(fin.transacao.taxaServico, 100);
        assert.equal(fin.transacao.valorTotal, 1100);
    });

    it('9. EventoSuiteTransacao não recebe taxa — agregado separado', () => {
        const fin = aplicarTaxasAdicionaisCheckout(
            { preco: 800, taxaServico: 200, valorTotal: 1000 },
            200
        );
        const linhaSuite = { preco: 800, taxaServico: 200, valorTotal: 1000 };
        assert.equal(linhaSuite.valorTotal, 1000);
        assert.equal(fin.valorTotalReserva, 1200);
        assert.notEqual(linhaSuite.valorTotal, fin.valorTotalReserva);
    });
});

describe('resolverPermissoesTaxasAdicionaisReserva', () => {
    it('Administrador tem CRUD completo', () => {
        const perm = resolverPermissoesTaxasAdicionaisReserva(
            TipoAcesso.Administrador
        );
        assert.equal(perm.podeVisualizar, true);
        assert.equal(perm.podeAdicionar, true);
        assert.equal(perm.podeEditar, true);
        assert.equal(perm.podeExcluir, true);
    });

    it('PDV só visualiza e adiciona', () => {
        const perm = resolverPermissoesTaxasAdicionaisReserva(TipoAcesso.PDV);
        assert.equal(perm.podeVisualizar, true);
        assert.equal(perm.podeAdicionar, true);
        assert.equal(perm.podeEditar, false);
        assert.equal(perm.podeExcluir, false);
    });

    it('Validador não possui permissão de taxas', () => {
        const perm = resolverPermissoesTaxasAdicionaisReserva(
            TipoAcesso.Validador
        );
        assert.equal(perm.podeVisualizar, false);
        assert.equal(perm.podeAdicionar, false);
        assert.equal(perm.podeEditar, false);
        assert.equal(perm.podeExcluir, false);
    });

    it('tipo_acesso ausente ou desconhecido não possui permissão', () => {
        const perm = resolverPermissoesTaxasAdicionaisReserva(null);
        assert.equal(perm.podeVisualizar, false);
        assert.equal(perm.podeAdicionar, false);
        assert.equal(perm.podeEditar, false);
        assert.equal(perm.podeExcluir, false);
    });
});

describe('obterPermissoesTaxasUsuario — ProdutorAcesso', () => {
    it('resolve permissões pelo tipo_acesso do produtor da reserva', async () => {
        const { ProdutorAcesso } = await import('../models/Produtor');
        const originalFindOne = ProdutorAcesso.findOne;
        ProdutorAcesso.findOne = (async () => ({
            tipoAcesso: TipoAcesso.PDV,
        })) as typeof ProdutorAcesso.findOne;

        try {
            const perm = await obterPermissoesTaxasUsuario(99, 7);
            assert.equal(perm.podeVisualizar, true);
            assert.equal(perm.podeAdicionar, true);
            assert.equal(perm.podeEditar, false);
            assert.equal(perm.podeExcluir, false);
        } finally {
            ProdutorAcesso.findOne = originalFindOne;
        }
    });

    it('Administrador no ProdutorAcesso do produtor retorna CRUD completo', async () => {
        const { ProdutorAcesso } = await import('../models/Produtor');
        const originalFindOne = ProdutorAcesso.findOne;
        ProdutorAcesso.findOne = (async () => ({
            tipoAcesso: TipoAcesso.Administrador,
        })) as typeof ProdutorAcesso.findOne;

        try {
            const perm = await obterPermissoesTaxasUsuario(10, 3);
            assert.equal(perm.podeEditar, true);
            assert.equal(perm.podeExcluir, true);
        } finally {
            ProdutorAcesso.findOne = originalFindOne;
        }
    });

    it('Validador no ProdutorAcesso retorna sem permissão', async () => {
        const { ProdutorAcesso } = await import('../models/Produtor');
        const originalFindOne = ProdutorAcesso.findOne;
        ProdutorAcesso.findOne = (async () => ({
            tipoAcesso: TipoAcesso.Validador,
        })) as typeof ProdutorAcesso.findOne;

        try {
            const perm = await obterPermissoesTaxasUsuario(11, 4);
            assert.equal(perm.podeVisualizar, false);
            assert.equal(perm.podeAdicionar, false);
        } finally {
            ProdutorAcesso.findOne = originalFindOne;
        }
    });
});

describe('parseTaxasAdicionaisCheckout', () => {
    it('retorna array vazio quando ausente', () => {
        assert.deepEqual(parseTaxasAdicionaisCheckout({}), []);
    });

    it('4. parse de taxas com ordem e idEventoSuite', () => {
        const taxas = parseTaxasAdicionaisCheckout({
            taxasAdicionais: [
                {
                    descricao: 'Decoração',
                    valor: 150,
                    ordem: 1,
                    idEventoSuite: 7,
                },
                {
                    descricao: 'Jantar',
                    valor: 100,
                    ordem: 2,
                    idEventoSuite: 8,
                },
            ],
        });
        assert.equal(taxas.length, 2);
        assert.equal(taxas[0].descricao, 'Decoração');
        assert.equal(taxas[0].valor, 150);
        assert.equal(taxas[0].idEventoSuite, 7);
        assert.equal(taxas[1].valor, 100);
        assert.equal(taxas[1].idEventoSuite, 8);
    });

    it('rejeita taxa sem idEventoSuite', () => {
        assert.throws(
            () =>
                parseTaxasAdicionaisCheckout({
                    taxasAdicionais: [{ descricao: 'Decoração', valor: 100 }],
                }),
            /idEventoSuite/
        );
    });
});

describe('validarIdReservaSuiteParaTaxa', () => {
    it('aceita idReservaSuite válido da mesma reserva', async () => {
        const originalFindOne = ReservaSuite.findOne;
        ReservaSuite.findOne = (async () => ({
            id: 164,
            idReservaHospedagem: 50,
        })) as typeof ReservaSuite.findOne;

        try {
            const id = await validarIdReservaSuiteParaTaxa({
                idReservaHospedagem: 50,
                idReservaSuite: 164,
                obrigatorio: true,
            });
            assert.equal(id, 164);
        } finally {
            ReservaSuite.findOne = originalFindOne;
        }
    });

    it('rejeita nova taxa sem idReservaSuite', async () => {
        await assert.rejects(
            () =>
                validarIdReservaSuiteParaTaxa({
                    idReservaHospedagem: 50,
                    obrigatorio: true,
                }),
            /obrigatório/
        );
    });

    it('rejeita idReservaSuite inexistente', async () => {
        const originalFindOne = ReservaSuite.findOne;
        ReservaSuite.findOne = (async () => null) as typeof ReservaSuite.findOne;

        try {
            await assert.rejects(
                () =>
                    validarIdReservaSuiteParaTaxa({
                        idReservaHospedagem: 50,
                        idReservaSuite: 999,
                        obrigatorio: true,
                    }),
                /não encontrada/
            );
        } finally {
            ReservaSuite.findOne = originalFindOne;
        }
    });

    it('rejeita idReservaSuite de outra reserva', async () => {
        const originalFindOne = ReservaSuite.findOne;
        ReservaSuite.findOne = (async () => ({
            id: 164,
            idReservaHospedagem: 99,
        })) as typeof ReservaSuite.findOne;

        try {
            await assert.rejects(
                () =>
                    validarIdReservaSuiteParaTaxa({
                        idReservaHospedagem: 50,
                        idReservaSuite: 164,
                        obrigatorio: true,
                    }),
                /não pertence/
            );
        } finally {
            ReservaSuite.findOne = originalFindOne;
        }
    });

    it('permite taxa legada sem idReservaSuite quando não obrigatório', async () => {
        const id = await validarIdReservaSuiteParaTaxa({
            idReservaHospedagem: 50,
            obrigatorio: false,
        });
        assert.equal(id, null);
    });

    it('permite associar suíte em edição de taxa legada', async () => {
        const originalFindOne = ReservaSuite.findOne;
        ReservaSuite.findOne = (async () => ({
            id: 200,
            idReservaHospedagem: 50,
        })) as typeof ReservaSuite.findOne;

        try {
            const id = await validarIdReservaSuiteParaTaxa({
                idReservaHospedagem: 50,
                idReservaSuite: 200,
                obrigatorio: false,
            });
            assert.equal(id, 200);
        } finally {
            ReservaSuite.findOne = originalFindOne;
        }
    });
});

describe('resolverIdReservaSuitePorEventoSuite — checkout recepção', () => {
    const suitesCriadas = [
        { id: 164, idEventoSuite: 7 },
        { id: 165, idEventoSuite: 8 },
    ];

    it('resolve idReservaSuite por idEventoSuite após criar suítes', () => {
        assert.equal(
            resolverIdReservaSuitePorEventoSuite(suitesCriadas, 7),
            164
        );
        assert.equal(
            resolverIdReservaSuitePorEventoSuite(suitesCriadas, 8),
            165
        );
    });

    it('rejeita idEventoSuite fora das suítes do checkout', () => {
        assert.throws(
            () => resolverIdReservaSuitePorEventoSuite(suitesCriadas, 99),
            /não pertence/
        );
    });

    it('checkout com duas suítes e taxas distintas mantém financeiro agregado', () => {
        const totaisSuites = { preco: 1160, taxaServico: 0, valorTotal: 1160 };
        const taxas = [
            { descricao: 'Decoração', valor: 100, ordem: 1, idEventoSuite: 7 },
            { descricao: 'Limpeza', valor: 100, ordem: 2, idEventoSuite: 8 },
        ];
        const totalTaxas = somarValorTaxasAdicionais(taxas);
        const fin = aplicarTaxasAdicionaisCheckout(totaisSuites, totalTaxas);
        assert.equal(fin.valorTotalReserva, 1360);
        assert.equal(
            resolverIdReservaSuitePorEventoSuite(suitesCriadas, taxas[0].idEventoSuite),
            164
        );
        assert.equal(
            resolverIdReservaSuitePorEventoSuite(suitesCriadas, taxas[1].idEventoSuite),
            165
        );
    });
});

describe('mapeamento detalhe taxasAdicionais', () => {
    it('retorna idReservaSuite no payload do detalhe', () => {
        const taxasRows = [
            {
                id: 10,
                descricao: 'Decoração',
                valor: 100,
                ordem: 1,
                idReservaSuite: 164,
            },
            {
                id: 11,
                descricao: 'Taxa geral',
                valor: 50,
                ordem: 2,
                idReservaSuite: null,
            },
        ];

        const taxasAdicionais = taxasRows.map((taxa) => ({
            id: taxa.id,
            descricao: taxa.descricao,
            valor: Number(taxa.valor),
            ordem: Number(taxa.ordem || 1),
            idReservaSuite:
                taxa.idReservaSuite != null && Number(taxa.idReservaSuite) > 0
                    ? Number(taxa.idReservaSuite)
                    : null,
        }));

        assert.deepEqual(taxasAdicionais[0], {
            id: 10,
            descricao: 'Decoração',
            valor: 100,
            ordem: 1,
            idReservaSuite: 164,
        });
        assert.equal(taxasAdicionais[1].idReservaSuite, null);
    });
});

describe('label de vínculo da taxa (espelho do frontend)', () => {
    function resolverVinculoTaxaLabel(
        taxa: { idReservaSuite?: number | null },
        suites: Array<{ idReservaSuite: number; nome: string }>
    ): string {
        const idReservaSuite = Number(taxa.idReservaSuite ?? 0);
        if (Number.isFinite(idReservaSuite) && idReservaSuite > 0) {
            const suite = suites.find(
                (item) => item.idReservaSuite === idReservaSuite
            );
            if (suite?.nome) {
                return suite.nome;
            }
        }
        return 'Reserva';
    }

    const suites = [
        { idReservaSuite: 164, nome: 'Suíte Master' },
        { idReservaSuite: 165, nome: 'Suíte Família' },
    ];

    it('taxa vinculada mostra nome real da suíte', () => {
        assert.equal(
            resolverVinculoTaxaLabel({ idReservaSuite: 164 }, suites),
            'Suíte Master'
        );
    });

    it('taxa sem vínculo mostra Reserva', () => {
        assert.equal(
            resolverVinculoTaxaLabel({ idReservaSuite: null }, suites),
            'Reserva'
        );
    });
});
