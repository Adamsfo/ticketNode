import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StatusReservaHospedagem } from '../models/ReservaHospedagem';
import { CustomError } from '../utils/customError';
import {
    avaliarCancelamentoAdminStatus,
    validarMotivoCancelamentoAdmin,
} from './hospedagemCancelamentoAdminService';

describe('validarMotivoCancelamentoAdmin', () => {
    it('aceita motivo não vazio após trim', () => {
        assert.equal(validarMotivoCancelamentoAdmin('  Cliente desistiu  '), 'Cliente desistiu');
    });

    it('rejeita motivo vazio', () => {
        assert.throws(
            () => validarMotivoCancelamentoAdmin('   '),
            (err: unknown) =>
                err instanceof CustomError && err.statusCode === 400
        );
    });
});

describe('avaliarCancelamentoAdminStatus', () => {
    it('Confirmada → cancel', () => {
        assert.deepEqual(
            avaliarCancelamentoAdminStatus(StatusReservaHospedagem.Confirmada),
            { action: 'cancel' }
        );
    });

    it('AguardandoPagamento → cancel', () => {
        assert.deepEqual(
            avaliarCancelamentoAdminStatus(
                StatusReservaHospedagem.AguardandoPagamento
            ),
            { action: 'cancel' }
        );
    });

    it('Cancelada → idempotent', () => {
        assert.deepEqual(
            avaliarCancelamentoAdminStatus(StatusReservaHospedagem.Cancelada),
            { action: 'idempotent' }
        );
    });

    it('Hospedada → bloqueia', () => {
        assert.throws(
            () => avaliarCancelamentoAdminStatus(StatusReservaHospedagem.Hospedada),
            (err: unknown) =>
                err instanceof CustomError && err.statusCode === 400
        );
    });

    it('Expirada → bloqueia', () => {
        assert.throws(
            () => avaliarCancelamentoAdminStatus(StatusReservaHospedagem.Expirada),
            (err: unknown) =>
                err instanceof CustomError && err.statusCode === 400
        );
    });

    it('CheckOutRealizado → bloqueia', () => {
        assert.throws(
            () =>
                avaliarCancelamentoAdminStatus(
                    StatusReservaHospedagem.CheckOutRealizado
                ),
            (err: unknown) =>
                err instanceof CustomError && err.statusCode === 400
        );
    });
});
