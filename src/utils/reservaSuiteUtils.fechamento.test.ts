import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fromZonedTime } from 'date-fns-tz';
import {
    criarVerificadorFechamentosExcepcionais,
    dataCivilHospedagem,
    isDataCivilFechadaSemanalHospedagem,
    periodoHospedagemIncluiDiaFechado,
    validarPeriodoPousadaFechado,
    MSG_DIAS_FECHADOS_HOSPEDAGEM,
    MSG_PERIODO_FECHADO_EXCEPCIONAL_HOSPEDAGEM,
} from './reservaSuiteUtils';
import { CustomError } from './customError';

const TZ = 'America/Cuiaba';

function dt(civil: string, hora = '16:00:00'): Date {
    return fromZonedTime(`${civil} ${hora}`, TZ);
}

describe('reservaSuiteUtils — fechamentos pousada', () => {
    it('terça civil continua fechada', () => {
        assert.equal(isDataCivilFechadaSemanalHospedagem('2026-10-20'), true);
    });

    it('quinta civil não é fechada semanal', () => {
        assert.equal(isDataCivilFechadaSemanalHospedagem('2026-10-22'), false);
    });

    it('dia excepcional fechado', () => {
        const v = criarVerificadorFechamentosExcepcionais([
            { inicio: '2026-10-25', fim: '2026-10-25' },
        ]);
        assert.equal(
            periodoHospedagemIncluiDiaFechado(
                dt('2026-10-24'),
                dt('2026-10-26', '13:00:00'),
                v
            ),
            true
        );
    });

    it('intervalo inclusivo no meio do período', () => {
        const v = criarVerificadorFechamentosExcepcionais([
            { inicio: '2026-12-24', fim: '2026-12-26' },
        ]);
        assert.equal(
            periodoHospedagemIncluiDiaFechado(
                dt('2026-12-20'),
                dt('2026-12-28', '13:00:00'),
                v
            ),
            true
        );
    });

    it('fechamento inativo (verificador vazio) não bloqueia', () => {
        const v = criarVerificadorFechamentosExcepcionais([]);
        assert.equal(
            periodoHospedagemIncluiDiaFechado(
                dt('2026-10-25'),
                dt('2026-10-26', '13:00:00'),
                v
            ),
            false
        );
    });

    it('check-out em dia excepcional bloqueia', () => {
        const v = criarVerificadorFechamentosExcepcionais([
            { inicio: '2026-11-10', fim: '2026-11-10' },
        ]);
        assert.equal(
            periodoHospedagemIncluiDiaFechado(
                dt('2026-11-09'),
                dt('2026-11-10', '13:00:00'),
                v
            ),
            true
        );
    });

    it('mensagem semanal preservada', () => {
        try {
            validarPeriodoPousadaFechado(dt('2026-10-19'), dt('2026-10-21', '13:00:00'));
            assert.fail('deveria lançar');
        } catch (e) {
            assert.ok(e instanceof CustomError);
            assert.equal((e as CustomError).message, MSG_DIAS_FECHADOS_HOSPEDAGEM);
        }
    });

    it('mensagem excepcional', () => {
        const v = criarVerificadorFechamentosExcepcionais([
            { inicio: '2026-10-25', fim: '2026-10-25' },
        ]);
        try {
            validarPeriodoPousadaFechado(
                dt('2026-10-24'),
                dt('2026-10-26', '13:00:00'),
                v
            );
            assert.fail('deveria lançar');
        } catch (e) {
            assert.ok(e instanceof CustomError);
            assert.equal(
                (e as CustomError).message,
                MSG_PERIODO_FECHADO_EXCEPCIONAL_HOSPEDAGEM
            );
        }
    });

    it('data civil em Cuiabá', () => {
        const instante = fromZonedTime('2026-10-21 02:00:00', TZ);
        assert.equal(dataCivilHospedagem(instante), '2026-10-21');
    });
});
