/**
 * node --require ts-node/register/transpile-only --test \
 *   src/api/apiJango.getCaixaResumo.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    agregarResumoCaixaPdvDias,
    buildFiltroDataCaixaResumoPdvDia,
    listarDiasIsoCaixaResumoPdv,
    sqlResumoCaixaPdvDia,
    type CaixaResumoPdv,
} from './apiJango';

function resumoDia(
    totalVendido: number,
    totalRecebido: number,
    idCaixa = 100
): CaixaResumoPdv {
    return {
        idCaixa,
        dataAbertura: '2026-10-01',
        dataFechamento: null,
        status: 'A',
        totalVendido,
        totalRecebido,
    };
}

describe('buildFiltroDataCaixaResumoPdvDia', () => {
    it('um dia → igualdade na data', () => {
        assert.equal(
            buildFiltroDataCaixaResumoPdvDia('2026-10-01'),
            "CAST(CAIXA.DATA_ABERTURA AS DATE) = DATE '2026-10-01'"
        );
    });
});

describe('sqlResumoCaixaPdvDia', () => {
    it('usa FIRST 1 e ORDER BY ID_CAIXA DESC', () => {
        const sql = sqlResumoCaixaPdvDia('2026-10-05');
        assert.match(sql, /SELECT FIRST 1/i);
        assert.match(sql, /ORDER BY CAIXA\.ID_CAIXA DESC/i);
        assert.match(
            sql,
            /CAST\(CAIXA\.DATA_ABERTURA AS DATE\) = DATE '2026-10-05'/
        );
    });

    it('não usa SQL agregada de período', () => {
        const sql = sqlResumoCaixaPdvDia('2026-10-01');
        assert.doesNotMatch(sql, /\bSUM\s*\(/i);
        assert.doesNotMatch(sql, /\bMAX\s*\(/i);
        assert.doesNotMatch(sql, /\bGROUP BY\b/i);
        assert.doesNotMatch(sql, /\bBETWEEN\b/i);
    });
});

describe('listarDiasIsoCaixaResumoPdv', () => {
    it('01/10 → 01/10: um dia', () => {
        assert.deepEqual(
            listarDiasIsoCaixaResumoPdv('2026-10-01', '2026-10-01'),
            ['2026-10-01']
        );
    });

    it('01/10 → 02/10: dois dias', () => {
        assert.deepEqual(
            listarDiasIsoCaixaResumoPdv('2026-10-01', '2026-10-02'),
            ['2026-10-01', '2026-10-02']
        );
    });

    it('01/10 → 07/10: sete dias', () => {
        assert.equal(
            listarDiasIsoCaixaResumoPdv('2026-10-01', '2026-10-07').length,
            7
        );
        assert.deepEqual(
            listarDiasIsoCaixaResumoPdv('2026-10-01', '2026-10-07')[0],
            '2026-10-01'
        );
        assert.deepEqual(
            listarDiasIsoCaixaResumoPdv('2026-10-01', '2026-10-07')[6],
            '2026-10-07'
        );
    });
});

describe('agregarResumoCaixaPdvDias', () => {
    it('01/10 → 02/10: soma dois dias com caixa', () => {
        const agregado = agregarResumoCaixaPdvDias([
            resumoDia(100, 80, 1),
            resumoDia(50, 40, 2),
        ]);
        assert.equal(agregado.idCaixa, null);
        assert.equal(agregado.totalVendido, 150);
        assert.equal(agregado.totalRecebido, 120);
        assert.equal(agregado.status, null);
    });

    it('01/10 → 07/10: soma sete dias (alguns null)', () => {
        const partes: Array<CaixaResumoPdv | null> = [
            resumoDia(10, 9, 1),
            null,
            resumoDia(20, 18, 3),
            null,
            resumoDia(5, 4, 5),
            null,
            resumoDia(1, 1, 7),
        ];
        const agregado = agregarResumoCaixaPdvDias(partes);
        assert.equal(agregado.totalVendido, 36);
        assert.equal(agregado.totalRecebido, 32);
    });

    it('somente alguns dias com caixa — demais contam zero', () => {
        const agregado = agregarResumoCaixaPdvDias([
            null,
            resumoDia(200, 150),
            null,
        ]);
        assert.equal(agregado.totalVendido, 200);
        assert.equal(agregado.totalRecebido, 150);
    });

    it('período sem nenhum caixa → zeros', () => {
        const agregado = agregarResumoCaixaPdvDias([null, null, null]);
        assert.equal(agregado.idCaixa, null);
        assert.equal(agregado.totalVendido, 0);
        assert.equal(agregado.totalRecebido, 0);
    });
});
