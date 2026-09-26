import { cancelarReservasExpiradas } from '../services/reservaSuiteService';
import { iniciarJobCheckoutAutomaticoHospedagem } from './hospedagemCheckoutAutomaticoJob';

const INTERVALO_MS = 60 * 1000;

let jobExpiracaoEmExecucao = false;

async function executarExpiracaoComLock(): Promise<void> {
    if (jobExpiracaoEmExecucao) {
        return;
    }

    jobExpiracaoEmExecucao = true;
    try {
        const quantidade = await cancelarReservasExpiradas();
        if (quantidade > 0) {
            console.log(
                `[job] ${quantidade} reserva(s) de hospedagem expirada(s).`
            );
        }
    } catch (error) {
        console.error('[job] Erro ao expirar reservas de hospedagem:', error);
    } finally {
        jobExpiracaoEmExecucao = false;
    }
}

export function iniciarJobsReservaHospedagem(): void {
    iniciarJobCheckoutAutomaticoHospedagem();

    setInterval(() => {
        void executarExpiracaoComLock();
    }, INTERVALO_MS);
}

/** Apenas para testes — reinicia estado in-memory do job de expiração. */
export function resetEstadoJobExpiracaoReservaHospedagem(): void {
    jobExpiracaoEmExecucao = false;
}

export const reservaHospedagemJobsTestHelpers = {
    executarExpiracaoComLock,
    getJobExpiracaoEmExecucao: () => jobExpiracaoEmExecucao,
    setJobExpiracaoEmExecucao: (valor: boolean) => {
        jobExpiracaoEmExecucao = valor;
    },
};
