"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reservaHospedagemJobsTestHelpers = void 0;
exports.iniciarJobsReservaHospedagem = iniciarJobsReservaHospedagem;
exports.resetEstadoJobExpiracaoReservaHospedagem = resetEstadoJobExpiracaoReservaHospedagem;
const reservaSuiteService_1 = require("../services/reservaSuiteService");
const hospedagemCheckoutAutomaticoJob_1 = require("./hospedagemCheckoutAutomaticoJob");
const INTERVALO_MS = 60 * 1000;
let jobExpiracaoEmExecucao = false;
async function executarExpiracaoComLock() {
    if (jobExpiracaoEmExecucao) {
        return;
    }
    jobExpiracaoEmExecucao = true;
    try {
        const quantidade = await (0, reservaSuiteService_1.cancelarReservasExpiradas)();
        if (quantidade > 0) {
            console.log(`[job] ${quantidade} reserva(s) de hospedagem expirada(s).`);
        }
    }
    catch (error) {
        console.error('[job] Erro ao expirar reservas de hospedagem:', error);
    }
    finally {
        jobExpiracaoEmExecucao = false;
    }
}
function iniciarJobsReservaHospedagem() {
    (0, hospedagemCheckoutAutomaticoJob_1.iniciarJobCheckoutAutomaticoHospedagem)();
    setInterval(() => {
        void executarExpiracaoComLock();
    }, INTERVALO_MS);
}
/** Apenas para testes — reinicia estado in-memory do job de expiração. */
function resetEstadoJobExpiracaoReservaHospedagem() {
    jobExpiracaoEmExecucao = false;
}
exports.reservaHospedagemJobsTestHelpers = {
    executarExpiracaoComLock,
    getJobExpiracaoEmExecucao: () => jobExpiracaoEmExecucao,
    setJobExpiracaoEmExecucao: (valor) => {
        jobExpiracaoEmExecucao = valor;
    },
};
