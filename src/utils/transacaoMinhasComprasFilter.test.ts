/**
 * node --require ts-node/register/transpile-only --test \
 *   src/utils/transacaoMinhasComprasFilter.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Op } from 'sequelize';
import { OrigemTransacao } from '../models/Transacao';
import {
    buildWhereExcluirTransacaoHospedagem,
    deveExcluirHospedagemDaListagemMinhasCompras,
    ehTransacaoHospedagem,
} from './transacaoMinhasComprasFilter';

describe('deveExcluirHospedagemDaListagemMinhasCompras', () => {
    it('aplica filtro na listagem de Minhas Compras (idUsuario + status)', () => {
        assert.equal(
            deveExcluirHospedagemDaListagemMinhasCompras({
                idUsuario: 10,
                status: 'Pago',
            }),
            true
        );
    });

    it('não aplica filtro quando consulta transação específica por id', () => {
        assert.equal(
            deveExcluirHospedagemDaListagemMinhasCompras({
                id: 99,
            }),
            false
        );
        assert.equal(
            deveExcluirHospedagemDaListagemMinhasCompras({
                idUsuario: 10,
                id: 99,
            }),
            false
        );
    });

    it('não aplica filtro sem idUsuario', () => {
        assert.equal(
            deveExcluirHospedagemDaListagemMinhasCompras({ status: 'Pago' }),
            false
        );
        assert.equal(deveExcluirHospedagemDaListagemMinhasCompras({}), false);
        assert.equal(
            deveExcluirHospedagemDaListagemMinhasCompras(undefined),
            false
        );
    });
});

describe('ehTransacaoHospedagem', () => {
    it('identifica por origem_transacao HOSPEDAGEM', () => {
        assert.equal(
            ehTransacaoHospedagem({
                origemTransacao: OrigemTransacao.HOSPEDAGEM,
            }),
            true
        );
    });

    it('identifica transação antiga vinculada a ReservaHospedagem', () => {
        assert.equal(
            ehTransacaoHospedagem({
                origemTransacao: OrigemTransacao.INGRESSOS,
                vinculadaReservaHospedagem: true,
            }),
            true
        );
    });

    it('identifica transação antiga com EventoSuiteTransacao', () => {
        assert.equal(
            ehTransacaoHospedagem({
                origemTransacao: OrigemTransacao.INGRESSOS,
                vinculadaEventoSuiteTransacao: true,
            }),
            true
        );
    });

    it('não classifica compra de ingresso comum', () => {
        assert.equal(
            ehTransacaoHospedagem({
                origemTransacao: OrigemTransacao.INGRESSOS,
            }),
            false
        );
    });
});

describe('buildWhereExcluirTransacaoHospedagem', () => {
    it('monta condição com origem e vínculos estruturais', () => {
        const where = buildWhereExcluirTransacaoHospedagem();
        const andClause = (where as any)[Op.and];
        assert.ok(Array.isArray(andClause));
        assert.equal(andClause.length, 1);

        const notClause = andClause[0][Op.not];
        const orClause = notClause[Op.or];
        assert.equal(orClause.length, 3);
        assert.deepEqual(orClause[0], {
            origemTransacao: OrigemTransacao.HOSPEDAGEM,
        });
    });
});
