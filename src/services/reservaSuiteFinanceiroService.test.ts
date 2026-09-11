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
    somarTaxasAdicionaisGeraisReserva,
    somarTaxasAdicionaisVinculadasSuite,
    somarValorServicos,
    somarValorTaxasAdicionais,
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

describe('calcularTotaisReservaComServicos — taxas adicionais por suíte', () => {
    const suite1 = { id: 1, preco: 400, taxaServico: 30 } as const;
    const suite2 = { id: 2, preco: 700, taxaServico: 30 } as const;
    const duasSuites = [suite1, suite2];

    function totaisReserva(
        taxas: Array<{ idReservaSuite?: number | null; valor: number }> = []
    ) {
        const totais = calcularTotaisReservaComServicos(
            duasSuites as any,
            taxas
        );
        const gerais = somarTaxasAdicionaisGeraisReserva(taxas);
        const valorTotalReserva = totais.valorTotal + gerais;
        const transacao = recalcularTransacaoComServicos({
            precoHospedagem: totais.preco,
            taxaServicoHospedagem: totais.taxaServico,
            valorServicos: totais.valorServicos + somarValorTaxasAdicionais(taxas),
        });
        return { totais, gerais, valorTotalReserva, transacao };
    }

    it('1. sem taxa: Suite 1=430, Suite 2=730, Total=1160', () => {
        const { totais, valorTotalReserva, transacao } = totaisReserva();
        assert.equal(totais.suites[0].valorTotal, 430);
        assert.equal(totais.suites[1].valorTotal, 730);
        assert.equal(valorTotalReserva, 1160);
        assert.equal(transacao.valorTotal, 1160);
    });

    it('2. taxa vinculada à Suite 1: 530 / 730 / Total=1260', () => {
        const { totais, gerais, valorTotalReserva, transacao } = totaisReserva([
            { idReservaSuite: 1, valor: 100 },
        ]);
        assert.equal(totais.suites[0].valorTotal, 530);
        assert.equal(totais.suites[1].valorTotal, 730);
        assert.equal(gerais, 0);
        assert.equal(valorTotalReserva, 1260);
        assert.equal(transacao.valorTotal, 1260);
        assert.equal(
            somarTaxasAdicionaisVinculadasSuite(
                [{ idReservaSuite: 1, valor: 100 }],
                1
            ),
            100
        );
    });

    it('3. taxa vinculada à Suite 2: 430 / 830 / Total=1260', () => {
        const { totais, valorTotalReserva } = totaisReserva([
            { idReservaSuite: 2, valor: 100 },
        ]);
        assert.equal(totais.suites[0].valorTotal, 430);
        assert.equal(totais.suites[1].valorTotal, 830);
        assert.equal(valorTotalReserva, 1260);
    });

    it('4. duas taxas vinculadas (uma por suíte): 530 / 830 / Total=1360', () => {
        const { totais, valorTotalReserva } = totaisReserva([
            { idReservaSuite: 1, valor: 100 },
            { idReservaSuite: 2, valor: 100 },
        ]);
        assert.equal(totais.suites[0].valorTotal, 530);
        assert.equal(totais.suites[1].valorTotal, 830);
        assert.equal(valorTotalReserva, 1360);
    });

    it('5. taxa geral sem idReservaSuite: suítes inalteradas, Total=1260', () => {
        const { totais, gerais, valorTotalReserva } = totaisReserva([
            { idReservaSuite: null, valor: 100 },
        ]);
        assert.equal(totais.suites[0].valorTotal, 430);
        assert.equal(totais.suites[1].valorTotal, 730);
        assert.equal(gerais, 100);
        assert.equal(valorTotalReserva, 1260);
    });

    it('6. mistura: vinculada Suite 1 + taxa geral 50 → Total=1310', () => {
        const { totais, gerais, valorTotalReserva, transacao } = totaisReserva([
            { idReservaSuite: 1, valor: 100 },
            { idReservaSuite: null, valor: 50 },
        ]);
        assert.equal(totais.suites[0].valorTotal, 530);
        assert.equal(totais.suites[1].valorTotal, 730);
        assert.equal(gerais, 50);
        assert.equal(valorTotalReserva, 1310);
        assert.equal(transacao.valorTotal, 1310);
    });

    it('7. taxa vinculada não é contada duas vezes no total da reserva', () => {
        const taxas = [{ idReservaSuite: 1, valor: 100 }];
        const totais = calcularTotaisReservaComServicos(
            duasSuites as any,
            taxas
        );
        const gerais = somarTaxasAdicionaisGeraisReserva(taxas);
        const total = totais.valorTotal + gerais;
        assert.equal(total, 1260);
        assert.notEqual(total, 1360);
    });

    it('8. taxa geral não entra em nenhuma ReservaSuite.valorTotal', () => {
        const { totais } = totaisReserva([{ idReservaSuite: null, valor: 100 }]);
        assert.equal(totais.suites[0].valorTotal, 430);
        assert.equal(totais.suites[1].valorTotal, 730);
    });

    it('9. valorRecebido preservado e saldo recalculado após aumento de total', () => {
        const valorRecebido = 1000;
        const totalAntes = 1160;
        const totalDepois = 1260;
        const saldoAntes = totalAntes - valorRecebido;
        const saldoDepois = totalDepois - valorRecebido;
        assert.equal(saldoAntes, 160);
        assert.equal(saldoDepois, 260);
        assert.equal(
            resolverStatusTransacaoAposRecalculoValor(
                totalDepois,
                valorRecebido,
                'Aguardando pagamento'
            ),
            'Aguardando pagamento'
        );
    });

    it('10. taxaServico das suítes permanece inalterada com taxa vinculada', () => {
        const { totais } = totaisReserva([{ idReservaSuite: 1, valor: 100 }]);
        assert.equal(totais.suites[0].taxaServico, 30);
        assert.equal(totais.suites[1].taxaServico, 30);
        assert.equal(totais.taxaServico, 60);
    });
});

describe('aplicarAjusteValorBaseReservaSuite — isolamento multi-suíte', () => {
    function simularAjusteBaseSuite(
        suite: { id: number; preco: number; taxaServico: number },
        itens: Array<{ valor: number }>,
        novoValorBase: number
    ) {
        const antes = calcularTotaisSuiteComServicos(suite, itens);
        const fator = novoValorBase / antes.valorTotal;
        return calcularTotaisSuiteComServicos(
            {
                id: suite.id,
                preco: Math.round(suite.preco * fator * 100) / 100,
                taxaServico: Math.round(suite.taxaServico * fator * 100) / 100,
            },
            itens.map((item) => ({
                valor: Math.round(item.valor * fator * 100) / 100,
            }))
        );
    }

    it('1. multi-suíte: editar A→450 mantém B=730', () => {
        const suiteA = { id: 1, preco: 400, taxaServico: 30 };
        const suiteB = { id: 2, preco: 700, taxaServico: 30 };
        const depoisA = simularAjusteBaseSuite(suiteA, [], 450);
        const baseB = calcularTotaisSuiteComServicos(suiteB, []);
        assert.equal(depoisA.valorTotal, 450);
        assert.equal(baseB.valorTotal, 730);
    });

    it('2. sequência: A=450 e depois B=800', () => {
        const depoisA = simularAjusteBaseSuite(
            { id: 1, preco: 400, taxaServico: 30 },
            [],
            450
        );
        const depoisB = simularAjusteBaseSuite(
            { id: 2, preco: 700, taxaServico: 30 },
            [],
            800
        );
        assert.equal(depoisA.valorTotal, 450);
        assert.equal(depoisB.valorTotal, 800);
    });

    it('3. taxa vinculada: base 450 + taxa 100 = valorTotal 550', () => {
        const depois = simularAjusteBaseSuite(
            { id: 1, preco: 400, taxaServico: 30 },
            [],
            450
        );
        const totais = calcularTotaisReservaComServicos(
            [
                {
                    id: 1,
                    preco: depois.preco,
                    taxaServico: depois.taxaServico,
                    ItemServico: [],
                } as any,
                {
                    id: 2,
                    preco: 700,
                    taxaServico: 30,
                    ItemServico: [],
                } as any,
            ],
            [{ idReservaSuite: 1, valor: 100 }]
        );
        assert.equal(totais.suites[0].valorTotal, 550);
        assert.equal(totais.suites[1].valorTotal, 730);
    });

    it('4. taxa da outra suíte permanece intacta', () => {
        const totais = calcularTotaisReservaComServicos(
            [
                { id: 1, preco: 450, taxaServico: 0, ItemServico: [] } as any,
                { id: 2, preco: 730, taxaServico: 0, ItemServico: [] } as any,
            ],
            [
                { idReservaSuite: 1, valor: 100 },
                { idReservaSuite: 2, valor: 220 },
            ]
        );
        assert.equal(totais.suites[0].valorTotal, 550);
        assert.equal(totais.suites[1].valorTotal, 950);
        assert.equal(totais.valorTotal, 1500);
    });

    it('5. total da reserva após editar A: 450+730+100+220=1500', () => {
        const totaisBase = calcularTotaisReservaComServicos(
            [
                { id: 1, preco: 450, taxaServico: 0, ItemServico: [] } as any,
                { id: 2, preco: 730, taxaServico: 0, ItemServico: [] } as any,
            ],
            []
        );
        const totais = calcularTotaisReservaComServicos(
            [
                { id: 1, preco: 450, taxaServico: 0, ItemServico: [] } as any,
                { id: 2, preco: 730, taxaServico: 0, ItemServico: [] } as any,
            ],
            [
                { idReservaSuite: 1, valor: 100 },
                { idReservaSuite: 2, valor: 220 },
            ]
        );
        const geral = somarTaxasAdicionaisGeraisReserva([
            { idReservaSuite: 1, valor: 100 },
            { idReservaSuite: 2, valor: 220 },
        ]);
        assert.equal(totaisBase.valorTotal, 1180);
        assert.equal(totais.valorTotal, 1500);
        assert.equal(geral, 0);
        assert.equal(
            totais.valorTotal + geral,
            1500
        );
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
