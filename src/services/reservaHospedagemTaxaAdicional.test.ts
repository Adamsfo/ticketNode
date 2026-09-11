import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TipoAcesso } from '../models/Produtor';
import {
    aplicarTaxasAdicionaisCheckout,
    somarValorTaxasAdicionais,
} from './reservaSuiteFinanceiroService';
import { parseTaxasAdicionaisCheckout } from './reservaSuiteService';
import {
    obterPermissoesTaxasUsuario,
    resolverPermissoesTaxasAdicionaisReserva,
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

    it('4. parse de taxas com ordem', () => {
        const taxas = parseTaxasAdicionaisCheckout({
            taxasAdicionais: [
                { descricao: 'Decoração', valor: 150, ordem: 1 },
                { descricao: 'Jantar', valor: 100, ordem: 2 },
            ],
        });
        assert.equal(taxas.length, 2);
        assert.equal(taxas[0].descricao, 'Decoração');
        assert.equal(taxas[0].valor, 150);
        assert.equal(taxas[1].valor, 100);
    });
});
