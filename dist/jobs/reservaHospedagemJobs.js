"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.iniciarJobsReservaHospedagem = iniciarJobsReservaHospedagem;
const reservaSuiteService_1 = require("../services/reservaSuiteService");
const hospedagemCheckoutAutomaticoJob_1 = require("./hospedagemCheckoutAutomaticoJob");
const INTERVALO_MS = 60 * 1000;
function iniciarJobsReservaHospedagem() {
    (0, hospedagemCheckoutAutomaticoJob_1.iniciarJobCheckoutAutomaticoHospedagem)();
    setInterval(async () => {
        try {
            const quantidade = await (0, reservaSuiteService_1.cancelarReservasExpiradas)();
            if (quantidade > 0) {
                console.log(`[job] ${quantidade} reserva(s) de hospedagem expirada(s).`);
            }
        }
        catch (error) {
            console.error('[job] Erro ao expirar reservas de hospedagem:', error);
        }
    }, INTERVALO_MS);
}
