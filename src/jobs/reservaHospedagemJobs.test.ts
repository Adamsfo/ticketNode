import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const JOB_PATH = require.resolve('./reservaHospedagemJobs');
const SERVICE_PATH = require.resolve('../services/reservaSuiteService');

function limparModulosJob() {
    delete require.cache[JOB_PATH];
    delete require.cache[SERVICE_PATH];
}

function carregarJobComMockCancelar(
    onCancelar: () => Promise<number>
) {
    limparModulosJob();
    require.cache[SERVICE_PATH] = {
        id: SERVICE_PATH,
        filename: SERVICE_PATH,
        loaded: true,
        exports: {
            cancelarReservasExpiradas: onCancelar,
        },
    };
    return require('./reservaHospedagemJobs');
}

describe('reservaHospedagemJobs — mutex expiração', () => {
    beforeEach(() => {
        limparModulosJob();
    });

    afterEach(() => {
        limparModulosJob();
    });

    it('não executa duas expirações globais em paralelo', async () => {
        let emExecucao = 0;
        let maxParalelo = 0;
        let chamadas = 0;

        const job = carregarJobComMockCancelar(async () => {
            chamadas += 1;
            emExecucao += 1;
            maxParalelo = Math.max(maxParalelo, emExecucao);
            await new Promise((r) => setTimeout(r, 40));
            emExecucao -= 1;
            return 0;
        });

        job.resetEstadoJobExpiracaoReservaHospedagem();

        await Promise.all([
            job.reservaHospedagemJobsTestHelpers.executarExpiracaoComLock(),
            job.reservaHospedagemJobsTestHelpers.executarExpiracaoComLock(),
        ]);

        assert.equal(maxParalelo, 1);
        assert.equal(chamadas, 1);
    });

    it('libera lock após erro e permite nova execução', async () => {
        let tentativas = 0;
        const job = carregarJobComMockCancelar(async () => {
            tentativas += 1;
            if (tentativas === 1) {
                throw new Error('falha simulada');
            }
            return 0;
        });

        job.resetEstadoJobExpiracaoReservaHospedagem();

        await job.reservaHospedagemJobsTestHelpers.executarExpiracaoComLock();
        assert.equal(
            job.reservaHospedagemJobsTestHelpers.getJobExpiracaoEmExecucao(),
            false
        );

        await job.reservaHospedagemJobsTestHelpers.executarExpiracaoComLock();
        assert.equal(tentativas, 2);
    });
});
