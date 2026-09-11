import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    montarItemSuiteCheckoutLinha,
    resolverIdEventoSuiteCheckoutLinha,
} from './reservaSuiteService';
import { TipoReservaHospede } from '../models/ReservaHospede';

describe('checkout multi-suíte — idEventoSuite por linha', () => {
    const hospedes = [
        {
            nome: 'Hóspede',
            tipo: TipoReservaHospede.Adulto,
            dataNascimento: null,
        },
    ];

    it('preserva idEventoSuite de cada linha quando o item compartilhado é mutado', () => {
        const itemCompartilhado = {
            idEventoSuite: 8,
            adultos: 2,
            criancas: 0,
            hospedes,
        };

        const linhas = [
            montarItemSuiteCheckoutLinha(itemCompartilhado, { idEventoSuite: 8 }),
            montarItemSuiteCheckoutLinha(itemCompartilhado, { idEventoSuite: 10 }),
        ];

        itemCompartilhado.idEventoSuite = 10;

        assert.equal(linhas[0].idEventoSuite, 8);
        assert.equal(linhas[1].idEventoSuite, 10);
        assert.equal(itemCompartilhado.idEventoSuite, 10);
    });

    it('monta pares esperados para Suíte 8/430 e Suíte 10/450', () => {
        const suites = [
            {
                item: {
                    idEventoSuite: 8,
                    adultos: 2,
                    criancas: 0,
                    hospedes,
                },
                cotacao: { idEventoSuite: 8, valorTotal: 430 },
            },
            {
                item: {
                    idEventoSuite: 10,
                    adultos: 2,
                    criancas: 0,
                    hospedes,
                },
                cotacao: { idEventoSuite: 10, valorTotal: 450 },
            },
        ];

        const linhas = suites.map(({ item, cotacao }) => ({
            idEventoSuite: resolverIdEventoSuiteCheckoutLinha(cotacao),
            valorTotal: cotacao.valorTotal,
            item: montarItemSuiteCheckoutLinha(item, cotacao),
        }));

        assert.deepEqual(
            linhas.map((l) => ({
                idEventoSuite: l.idEventoSuite,
                valorTotal: l.valorTotal,
            })),
            [
                { idEventoSuite: 8, valorTotal: 430 },
                { idEventoSuite: 10, valorTotal: 450 },
            ]
        );
        assert.equal(linhas[0].item.idEventoSuite, 8);
        assert.equal(linhas[1].item.idEventoSuite, 10);
    });

    it('corrige item já mutado para o último id antes do create', () => {
        const itemMutado = {
            idEventoSuite: 10,
            adultos: 2,
            criancas: 0,
            hospedes,
        };

        const linha = montarItemSuiteCheckoutLinha(itemMutado, { idEventoSuite: 8 });

        assert.equal(linha.idEventoSuite, 8);
        assert.equal(itemMutado.idEventoSuite, 10);
    });
});
