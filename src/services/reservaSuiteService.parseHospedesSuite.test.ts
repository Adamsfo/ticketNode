/**
 * Parse de hóspedes no checkout — nome opcional somente na recepção.
 *
 * node --require ts-node/register/transpile-only --test \
 *   src/services/reservaSuiteService.parseHospedesSuite.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TipoReservaHospede } from '../models/ReservaHospede';
import { parseSuitesCheckout } from './reservaSuiteService';
import { CustomError } from '../utils/customError';

function criarBody(
    adultos: number,
    criancas: number,
    hospedes: Array<{
        nome?: string;
        tipo: TipoReservaHospede;
        dataNascimento?: string;
    }>
) {
    return {
        suites: [
            {
                idEventoSuite: 10,
                adultos,
                criancas,
                hospedes,
            },
        ],
    };
}

describe('parseSuitesCheckout — site/conferência (nome obrigatório)', () => {
    it('rejeita adulto sem nome quando nomeOpcional não é informado', () => {
        assert.throws(
            () =>
                parseSuitesCheckout(
                    criarBody(1, 0, [
                        { nome: '', tipo: TipoReservaHospede.Adulto },
                    ])
                ),
            (err: unknown) =>
                err instanceof CustomError &&
                String(err.message).includes('.nome é obrigatório')
        );
    });

    it('rejeita criança sem nome no checkout online', () => {
        assert.throws(
            () =>
                parseSuitesCheckout(
                    criarBody(1, 1, [
                        { nome: 'Adulto', tipo: TipoReservaHospede.Adulto },
                        {
                            nome: '',
                            tipo: TipoReservaHospede.Crianca,
                            dataNascimento: '2020-01-15',
                        },
                    ])
                ),
            (err: unknown) =>
                err instanceof CustomError &&
                String(err.message).includes('.nome é obrigatório')
        );
    });
});

describe('parseSuitesCheckout — recepção (nomeOpcional: true)', () => {
    it('3 adultos com somente 1 nome → parseia e mantém adultos=3', () => {
        const suites = parseSuitesCheckout(
            criarBody(3, 0, [
                { nome: 'Titular', tipo: TipoReservaHospede.Adulto },
                { nome: '', tipo: TipoReservaHospede.Adulto },
                { nome: '   ', tipo: TipoReservaHospede.Adulto },
            ]),
            { nomeOpcional: true }
        );

        assert.equal(suites.length, 1);
        assert.equal(suites[0].adultos, 3);
        assert.equal(suites[0].criancas, 0);
        assert.equal(suites[0].hospedes.length, 3);
        assert.equal(suites[0].hospedes[0].nome, 'Titular');
        assert.equal(suites[0].hospedes[1].nome, '');
        assert.equal(suites[0].hospedes[2].nome, '');
    });

    it('todos os nomes de adultos vazios → parseia com nome=""', () => {
        const suites = parseSuitesCheckout(
            criarBody(2, 0, [
                { nome: '', tipo: TipoReservaHospede.Adulto },
                { nome: '', tipo: TipoReservaHospede.Adulto },
            ]),
            { nomeOpcional: true }
        );

        assert.equal(suites[0].adultos, 2);
        assert.equal(suites[0].hospedes.every((h) => h.nome === ''), true);
    });

    it('criança sem nome mas com data de nascimento válida → parseia', () => {
        const suites = parseSuitesCheckout(
            criarBody(1, 1, [
                { nome: 'Adulto', tipo: TipoReservaHospede.Adulto },
                {
                    nome: '',
                    tipo: TipoReservaHospede.Crianca,
                    dataNascimento: '2020-06-01',
                },
            ]),
            { nomeOpcional: true }
        );

        assert.equal(suites[0].adultos, 1);
        assert.equal(suites[0].criancas, 1);
        assert.equal(suites[0].hospedes[1].nome, '');
        assert.ok(suites[0].hospedes[1].dataNascimento instanceof Date);
    });

    it('criança sem data de nascimento continua obrigatória', () => {
        assert.throws(
            () =>
                parseSuitesCheckout(
                    criarBody(1, 1, [
                        { nome: 'Adulto', tipo: TipoReservaHospede.Adulto },
                        {
                            nome: '',
                            tipo: TipoReservaHospede.Crianca,
                        },
                    ]),
                    { nomeOpcional: true }
                ),
            (err: unknown) =>
                err instanceof CustomError &&
                String(err.message).includes('dataNascimento é obrigatório')
        );
    });

    it('quantidade ReservaSuite.adultos/criancas permanece intacta no item parseado', () => {
        const suites = parseSuitesCheckout(
            criarBody(4, 2, [
                { nome: 'A1', tipo: TipoReservaHospede.Adulto },
                { nome: '', tipo: TipoReservaHospede.Adulto },
                { nome: '', tipo: TipoReservaHospede.Adulto },
                { nome: '', tipo: TipoReservaHospede.Adulto },
                {
                    nome: '',
                    tipo: TipoReservaHospede.Crianca,
                    dataNascimento: '2018-03-10',
                },
                {
                    nome: 'C2',
                    tipo: TipoReservaHospede.Crianca,
                    dataNascimento: '2019-07-20',
                },
            ]),
            { nomeOpcional: true }
        );

        assert.equal(suites[0].adultos, 4);
        assert.equal(suites[0].criancas, 2);
        assert.equal(suites[0].hospedes.length, 6);
    });
});
