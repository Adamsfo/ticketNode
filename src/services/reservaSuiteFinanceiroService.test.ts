import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    calcularTotaisReservaComServicos,
    calcularTotaisSuiteComServicos,
    calcularValorHospedagemSuite,
    recalcularLinhaEventoSuiteTransacaoComServicos,
    recalcularTransacaoComServicos,
    calcularValorTotalReservaAposSuites,
    resolverStatusTransacaoAposRecalculoValor,
    somarValorServicos,
} from './reservaSuiteFinanceiroService';
import { resolverPermissoesServicosSuite } from './reservaSuiteItemServicoService';
import { TipoAcesso } from '../models/Produtor';

describe('reservaSuiteFinanceiroService', () => {
    it('calcularValorHospedagemSuite soma preco + taxaServico', () => {
        assert.equal(calcularValorHospedagemSuite({ preco: 700, taxaServico: 100 }), 800);
    });

    it('calcularTotaisSuiteComServicos inclui serviços no total', () => {
        const totais = calcularTotaisSuiteComServicos(
            { id: 1, preco: 700, taxaServico: 100 },
            [{ valor: 150 }, { valor: 200 }]
        );
        assert.equal(totais.valorHospedagem, 800);
        assert.equal(totais.valorServicos, 350);
        assert.equal(totais.valorTotal, 1150);
    });

    it('Caso 1: 1 suíte — hospedagem 800 + serviços 300 = total 1.100', () => {
        const suite = calcularTotaisSuiteComServicos(
            { id: 1, preco: 700, taxaServico: 100 },
            [{ valor: 300 }]
        );
        assert.equal(suite.valorHospedagem, 800);
        assert.equal(suite.valorServicos, 300);
        assert.equal(suite.valorTotal, 1100);

        const tx = recalcularTransacaoComServicos({
            precoHospedagem: suite.preco,
            taxaServicoHospedagem: suite.taxaServico,
            valorServicos: suite.valorServicos,
        });
        assert.equal(tx.preco, 1000);
        assert.equal(tx.taxaServico, 100);
        assert.equal(tx.valorTotal, 1100);
        assert.equal(tx.preco + tx.taxaServico, tx.valorTotal);

        const linha = recalcularLinhaEventoSuiteTransacaoComServicos({
            preco: suite.preco,
            taxaServico: suite.taxaServico,
            valorServicos: suite.valorServicos,
        });
        assert.equal(linha.preco + linha.taxaServico, linha.valorTotal);
        assert.equal(linha.valorTotal, 1100);
    });

    it('Caso 2: 2 suítes — totais 1.100 + 1.100 = 2.200', () => {
        const totais = calcularTotaisReservaComServicos([
            {
                id: 1,
                preco: 700,
                taxaServico: 100,
                ItemServico: [{ valor: 300 }],
            } as any,
            {
                id: 2,
                preco: 900,
                taxaServico: 100,
                ItemServico: [{ valor: 100 }],
            } as any,
        ]);
        assert.equal(totais.suites[0].valorTotal, 1100);
        assert.equal(totais.suites[1].valorTotal, 1100);
        assert.equal(totais.valorTotal, 2200);

        const tx = recalcularTransacaoComServicos({
            precoHospedagem: totais.preco,
            taxaServicoHospedagem: totais.taxaServico,
            valorServicos: totais.valorServicos,
        });
        assert.equal(tx.preco, 2000);
        assert.equal(tx.taxaServico, 200);
        assert.equal(tx.valorTotal, 2200);
        assert.equal(tx.preco + tx.taxaServico, tx.valorTotal);
    });

    it('Caso 3: reserva já paga — serviço aumenta total e status volta para Aguardando pagamento', () => {
        const totaisAntes = calcularTotaisReservaComServicos([
            { id: 1, preco: 1800, taxaServico: 200, ItemServico: [] } as any,
        ]);
        assert.equal(totaisAntes.valorTotal, 2000);

        const totaisDepois = calcularTotaisReservaComServicos([
            {
                id: 1,
                preco: 1800,
                taxaServico: 200,
                ItemServico: [{ valor: 300 }],
            } as any,
        ]);
        assert.equal(totaisDepois.valorTotal, 2300);

        const valorRecebido = 2000;
        const saldoPendente = totaisDepois.valorTotal - valorRecebido;
        assert.equal(saldoPendente, 300);

        const status = resolverStatusTransacaoAposRecalculoValor(
            totaisDepois.valorTotal,
            valorRecebido,
            'Pago'
        );
        assert.equal(status, 'Aguardando pagamento');
    });

    it('Caso 4: remover serviço restaura total anterior', () => {
        const comServico = calcularTotaisSuiteComServicos(
            { id: 1, preco: 700, taxaServico: 100 },
            [{ valor: 300 }]
        );
        const semServico = calcularTotaisSuiteComServicos(
            { id: 1, preco: 700, taxaServico: 100 },
            []
        );
        assert.equal(comServico.valorTotal, 1100);
        assert.equal(semServico.valorTotal, 800);
        assert.equal(semServico.valorTotal, comServico.valorHospedagem);
    });

    it('Caso 5: alterar serviço reflete somente a diferença', () => {
        const antes = calcularTotaisSuiteComServicos(
            { id: 1, preco: 700, taxaServico: 100 },
            [{ valor: 200 }]
        );
        const depois = calcularTotaisSuiteComServicos(
            { id: 1, preco: 700, taxaServico: 100 },
            [{ valor: 350 }]
        );
        assert.equal(depois.valorTotal - antes.valorTotal, 150);
        assert.equal(depois.valorServicos - antes.valorServicos, 150);
        assert.equal(depois.valorHospedagem, antes.valorHospedagem);
    });

    it('Caso 6: alterar serviço da suíte 1 não altera valores da suíte 2', () => {
        const base = calcularTotaisReservaComServicos([
            {
                id: 1,
                preco: 700,
                taxaServico: 100,
                ItemServico: [{ valor: 100 }],
            } as any,
            {
                id: 2,
                preco: 900,
                taxaServico: 100,
                ItemServico: [{ valor: 50 }],
            } as any,
        ]);

        const alterado = calcularTotaisReservaComServicos([
            {
                id: 1,
                preco: 700,
                taxaServico: 100,
                ItemServico: [{ valor: 400 }],
            } as any,
            {
                id: 2,
                preco: 900,
                taxaServico: 100,
                ItemServico: [{ valor: 50 }],
            } as any,
        ]);

        const suite2Antes = base.suites.find((s) => s.idReservaSuite === 2);
        const suite2Depois = alterado.suites.find((s) => s.idReservaSuite === 2);
        assert.deepEqual(suite2Depois, suite2Antes);

        assert.equal(alterado.valorTotal - base.valorTotal, 300);
        assert.equal(
            alterado.suites[0].valorTotal - base.suites[0].valorTotal,
            300
        );
    });

    it('recalcularTransacaoComServicos mantém taxaServico e coloca serviços em preco', () => {
        const tx = recalcularTransacaoComServicos({
            precoHospedagem: 1800,
            taxaServicoHospedagem: 200,
            valorServicos: 250,
        });
        assert.equal(tx.valorTotal, 2250);
        assert.equal(tx.taxaServico, 200);
        assert.equal(tx.preco, 2050);
        assert.equal(tx.preco + tx.taxaServico, tx.valorTotal);
    });

    it('resolverStatusTransacaoAposRecalculoValor mantém Pago quando quitada', () => {
        assert.equal(
            resolverStatusTransacaoAposRecalculoValor(2000, 2000, 'Pago'),
            'Pago'
        );
        assert.equal(
            resolverStatusTransacaoAposRecalculoValor(2000, 2000, 'Aguardando pagamento'),
            'Pago'
        );
    });

    it('resolverStatusTransacaoAposRecalculoValor preserva Cancelado', () => {
        assert.equal(
            resolverStatusTransacaoAposRecalculoValor(2000, 0, 'Cancelado'),
            'Cancelado'
        );
    });

    it('somarValorServicos retorna zero para lista vazia', () => {
        assert.equal(somarValorServicos([]), 0);
    });

    it('calcularValorTotalReservaAposSuites soma suítes + taxas', () => {
        assert.equal(calcularValorTotalReservaAposSuites(500, 0), 500);
        assert.equal(calcularValorTotalReservaAposSuites(500, 200), 700);
        assert.equal(calcularValorTotalReservaAposSuites(600, 200), 800);
        assert.equal(calcularValorTotalReservaAposSuites(1200, 270), 1470);
    });
});

describe('resolverPermissoesServicosSuite', () => {
    it('Administrador tem CRUD completo', () => {
        const perm = resolverPermissoesServicosSuite({
            admGeral: false,
            idsProdutor: [1],
            tipoAcesso: TipoAcesso.Administrador,
        });
        assert.equal(perm.podeAdicionar, true);
        assert.equal(perm.podeEditar, true);
        assert.equal(perm.podeExcluir, true);
    });

    it('PDV só adiciona', () => {
        const perm = resolverPermissoesServicosSuite({
            admGeral: false,
            idsProdutor: [1],
            tipoAcesso: TipoAcesso.PDV,
        });
        assert.equal(perm.podeAdicionar, true);
        assert.equal(perm.podeEditar, false);
        assert.equal(perm.podeExcluir, false);
    });
});
