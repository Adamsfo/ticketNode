import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

const SERVICE_PATH = require.resolve(
    '../services/hospedagemCheckoutAutomaticoService'
);
const JOB_PATH = require.resolve('./hospedagemCheckoutAutomaticoJob');
const DATABASE_PATH = require.resolve('../database');

function limparModulosJob() {
    delete require.cache[JOB_PATH];
    delete require.cache[SERVICE_PATH];
    delete require.cache[DATABASE_PATH];
}

function mockDatabaseReady(databaseReady: Promise<void> = Promise.resolve()) {
    require.cache[DATABASE_PATH] = {
        id: DATABASE_PATH,
        filename: DATABASE_PATH,
        loaded: true,
        exports: {
            default: {},
            databaseReady,
        },
    };
}

function carregarJobComMockDiario(
    onDiario: () => Promise<unknown>,
    databaseReady: Promise<void> = Promise.resolve()
) {
    limparModulosJob();
    mockDatabaseReady(databaseReady);
    require.cache[SERVICE_PATH] = {
        id: SERVICE_PATH,
        filename: SERVICE_PATH,
        loaded: true,
        exports: {
            executarCheckoutAutomaticoDiario: onDiario,
        },
    };
    return require('./hospedagemCheckoutAutomaticoJob');
}

function resultadoVazio() {
    return {
        candidatas: 0,
        processadas: 0,
        checkoutExecutados: 0,
        ignoradas: 0,
        falhas: 0,
        itens: [],
    };
}

describe('hospedagemCheckoutAutomaticoJob — janela 02:00', () => {
    beforeEach(() => {
        limparModulosJob();
    });

    afterEach(() => {
        limparModulosJob();
    });

    it('01:59 não executa; 02:00 e 02:01 entram na janela; 02:02 não', () => {
        mockDatabaseReady();
        const { deveExecutarNestaJanela } = require(
            './hospedagemCheckoutAutomaticoJob'
        );

        const umaCinquentaENove = new Date('2026-09-21T05:59:00.000Z');
        assert.equal(deveExecutarNestaJanela(umaCinquentaENove), false);

        const asDuas = new Date('2026-09-21T06:00:00.000Z');
        assert.equal(deveExecutarNestaJanela(asDuas), true);

        const duasEum = new Date('2026-09-21T06:01:00.000Z');
        assert.equal(deveExecutarNestaJanela(duasEum), true);

        const duasDois = new Date('2026-09-21T06:02:00.000Z');
        assert.equal(deveExecutarNestaJanela(duasDois), false);

        const asTres = new Date('2026-09-21T07:00:00.000Z');
        assert.equal(deveExecutarNestaJanela(asTres), false);
    });
});

describe('hospedagemCheckoutAutomaticoJob — startup', () => {
    beforeEach(() => {
        limparModulosJob();
    });

    afterEach(() => {
        limparModulosJob();
    });

    async function executarStartup() {
        let chamadas = 0;
        const job = carregarJobComMockDiario(async () => {
            chamadas += 1;
            return resultadoVazio();
        });
        job.resetEstadoJobCheckoutAutomaticoHospedagem();
        await job.executarCheckoutAutomaticoNaInicializacao();
        return { job, chamadas };
    }

    it('servidor inicia às 10:00 → executa verificação', async () => {
        const { chamadas } = await executarStartup();
        assert.equal(chamadas, 1);
    });

    it('servidor inicia às 02:30 → executa verificação', async () => {
        const { chamadas } = await executarStartup();
        assert.equal(chamadas, 1);
    });

    it('servidor inicia às 23:00 → executa verificação', async () => {
        const { chamadas } = await executarStartup();
        assert.equal(chamadas, 1);
    });

    it('duas inicializações → cada uma executa verificação', async () => {
        let chamadas = 0;
        const job = carregarJobComMockDiario(async () => {
            chamadas += 1;
            return resultadoVazio();
        });
        job.resetEstadoJobCheckoutAutomaticoHospedagem();

        await job.executarCheckoutAutomaticoNaInicializacao();
        await job.executarCheckoutAutomaticoNaInicializacao();

        assert.equal(chamadas, 2);
    });

    it('aguarda databaseReady antes de executar a consulta', async () => {
        let resolveDb!: () => void;
        const databasePending = new Promise<void>((resolve) => {
            resolveDb = resolve;
        });
        let chamadas = 0;
        const job = carregarJobComMockDiario(async () => {
            chamadas += 1;
            return resultadoVazio();
        }, databasePending);
        job.resetEstadoJobCheckoutAutomaticoHospedagem();

        const startupPendente = job.executarCheckoutAutomaticoNaInicializacao();
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(chamadas, 0);

        resolveDb();
        await startupPendente;
        assert.equal(chamadas, 1);
    });
});

describe('hospedagemCheckoutAutomaticoJob — startup + 02:00', () => {
    beforeEach(() => {
        limparModulosJob();
    });

    afterEach(() => {
        limparModulosJob();
    });

    it('startup às 10:00 não bloqueia execução das 02:00 no mesmo dia', async () => {
        let chamadas = 0;
        const job = carregarJobComMockDiario(async () => {
            chamadas += 1;
            return resultadoVazio();
        });
        const { checkoutAutomaticoJobTestHelpers } = job;
        job.resetEstadoJobCheckoutAutomaticoHospedagem();

        await job.executarCheckoutAutomaticoNaInicializacao();
        assert.equal(chamadas, 1);
        assert.equal(
            checkoutAutomaticoJobTestHelpers.getUltimaDataExecutadaAgendada(),
            null
        );

        checkoutAutomaticoJobTestHelpers.setRelogioAgendado(
            () => new Date('2026-09-21T06:00:00.000Z')
        );
        await checkoutAutomaticoJobTestHelpers.tickCheckoutAutomaticoAgendado();

        assert.equal(chamadas, 2);
        assert.equal(
            checkoutAutomaticoJobTestHelpers.getUltimaDataExecutadaAgendada(),
            '2026-09-21'
        );
    });
});

describe('hospedagemCheckoutAutomaticoJob — agendamento diário', () => {
    beforeEach(() => {
        limparModulosJob();
    });

    afterEach(() => {
        limparModulosJob();
    });

    it('02:00 executa; 02:01 pode executar se ainda não executou; depois não repete no dia', async () => {
        let chamadas = 0;
        const job = carregarJobComMockDiario(async () => {
            chamadas += 1;
            return resultadoVazio();
        });
        const { checkoutAutomaticoJobTestHelpers } = job;
        job.resetEstadoJobCheckoutAutomaticoHospedagem();

        checkoutAutomaticoJobTestHelpers.setRelogioAgendado(
            () => new Date('2026-09-21T06:00:00.000Z')
        );
        await checkoutAutomaticoJobTestHelpers.tickCheckoutAutomaticoAgendado();
        assert.equal(chamadas, 1);

        checkoutAutomaticoJobTestHelpers.setRelogioAgendado(
            () => new Date('2026-09-21T06:01:00.000Z')
        );
        await checkoutAutomaticoJobTestHelpers.tickCheckoutAutomaticoAgendado();
        assert.equal(chamadas, 1);

        await checkoutAutomaticoJobTestHelpers.tickCheckoutAutomaticoAgendado();
        assert.equal(chamadas, 1);
    });

    it('dia seguinte executa novamente', async () => {
        let chamadas = 0;
        const job = carregarJobComMockDiario(async () => {
            chamadas += 1;
            return resultadoVazio();
        });
        const { checkoutAutomaticoJobTestHelpers } = job;
        job.resetEstadoJobCheckoutAutomaticoHospedagem();

        checkoutAutomaticoJobTestHelpers.setRelogioAgendado(
            () => new Date('2026-09-21T06:00:00.000Z')
        );
        await checkoutAutomaticoJobTestHelpers.tickCheckoutAutomaticoAgendado();
        assert.equal(chamadas, 1);

        checkoutAutomaticoJobTestHelpers.setRelogioAgendado(
            () => new Date('2026-09-22T06:00:00.000Z')
        );
        await checkoutAutomaticoJobTestHelpers.tickCheckoutAutomaticoAgendado();
        assert.equal(chamadas, 2);
    });
});
