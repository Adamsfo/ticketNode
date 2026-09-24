import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    VERSAO_POLITICA_HOSPEDAGEM,
    camposAceitePoliticaParaCreateCliente,
    camposAceitePoliticaParaUpdateLink,
    ehContratacaoClienteCheckoutSite,
    exigirAceitePoliticaCheckoutCliente,
    exigirAceitePoliticaReservaPublica,
} from './hospedagemPoliticaAceitePolicy';

describe('ehContratacaoClienteCheckoutSite', () => {
    it('identifica cliente reservando para si', () => {
        assert.equal(ehContratacaoClienteCheckoutSite(42, 42), true);
    });

    it('identifica PDV/recepção (id do hóspede ≠ operador logado)', () => {
        assert.equal(ehContratacaoClienteCheckoutSite(99, 5), false);
    });

    it('não confia em bypass omitindo flag do body — ids iguais exigem aceite', () => {
        assert.equal(ehContratacaoClienteCheckoutSite(10, 10), true);
    });

    it('ids inválidos não são contratação do cliente', () => {
        assert.equal(ehContratacaoClienteCheckoutSite(0, 1), false);
        assert.equal(ehContratacaoClienteCheckoutSite(1, 0), false);
    });
});

describe('exigirAceitePoliticaCheckoutCliente', () => {
    it('bloqueia checkout do cliente no site sem aceite', () => {
        assert.throws(
            () => exigirAceitePoliticaCheckoutCliente(true, false),
            (err: Error) => err.message.includes('Política de Cancelamento')
        );
        assert.throws(() => exigirAceitePoliticaCheckoutCliente(true, undefined));
    });

    it('permite checkout do cliente no site com aceite', () => {
        exigirAceitePoliticaCheckoutCliente(true, true);
    });

    it('não exige aceite quando não é contratação do cliente (PDV/recepção)', () => {
        exigirAceitePoliticaCheckoutCliente(false, false);
        exigirAceitePoliticaCheckoutCliente(false, undefined);
    });

    it('checkout com contratacaoCliente inferida falsa (PDV) não exige aceite', () => {
        exigirAceitePoliticaCheckoutCliente(false, false);
    });
});

describe('camposAceitePoliticaParaCreateCliente', () => {
    it('grava versão e data quando cliente aceita no site', () => {
        const agora = new Date('2026-09-24T12:00:00.000Z');
        const campos = camposAceitePoliticaParaCreateCliente(true, true, agora);
        assert.equal(campos.aceitePoliticaHospedagem, true);
        assert.equal(campos.dataAceitePoliticaHospedagem, agora);
        assert.equal(campos.versaoPoliticaHospedagem, VERSAO_POLITICA_HOSPEDAGEM);
    });

    it('não grava aceite para PDV/recepção', () => {
        const agora = new Date('2026-09-24T12:00:00.000Z');
        assert.deepEqual(
            camposAceitePoliticaParaCreateCliente(false, true, agora),
            {}
        );
        assert.deepEqual(
            camposAceitePoliticaParaCreateCliente(false, false, agora),
            {}
        );
    });

    it('não grava aceite falso se cliente não marcou', () => {
        const agora = new Date('2026-09-24T12:00:00.000Z');
        assert.deepEqual(
            camposAceitePoliticaParaCreateCliente(true, false, agora),
            {}
        );
    });
});

describe('exigirAceitePoliticaReservaPublica', () => {
    it('bloqueia link externo sem aceite', () => {
        assert.throws(() => exigirAceitePoliticaReservaPublica({ suites: [] }));
        assert.throws(() =>
            exigirAceitePoliticaReservaPublica({
                aceitePoliticaHospedagem: false,
                suites: [],
            })
        );
    });

    it('permite link externo com aceite', () => {
        exigirAceitePoliticaReservaPublica({
            aceitePoliticaHospedagem: true,
            suites: [],
        });
    });
});

describe('camposAceitePoliticaParaUpdateLink', () => {
    it('grava aceite na primeira vez', () => {
        const agora = new Date('2026-09-24T15:00:00.000Z');
        const campos = camposAceitePoliticaParaUpdateLink(agora, false);
        assert.equal(campos.aceitePoliticaHospedagem, true);
        assert.equal(campos.versaoPoliticaHospedagem, VERSAO_POLITICA_HOSPEDAGEM);
    });

    it('não sobrescreve se já aceito', () => {
        const campos = camposAceitePoliticaParaUpdateLink(new Date(), true);
        assert.deepEqual(campos, {});
    });
});
