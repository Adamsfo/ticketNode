import { cancelarReservasExpiradas } from '../services/reservaSuiteService';
import { iniciarJobCheckoutAutomaticoHospedagem } from './hospedagemCheckoutAutomaticoJob';

const INTERVALO_MS = 60 * 1000;

export function iniciarJobsReservaHospedagem(): void {
    iniciarJobCheckoutAutomaticoHospedagem();

    setInterval(async () => {
        try {
            const quantidade = await cancelarReservasExpiradas();
            if (quantidade > 0) {
                console.log(
                    `[job] ${quantidade} reserva(s) de hospedagem expirada(s).`
                );
            }
        } catch (error) {
            console.error('[job] Erro ao expirar reservas de hospedagem:', error);
        }
    }, INTERVALO_MS);
}
