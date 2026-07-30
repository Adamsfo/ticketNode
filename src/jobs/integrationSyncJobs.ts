import { bootstrapIntegrationProviders } from '../integrations/bootstrap';
import { startIntegrationScheduler } from '../integrations/core/IntegrationScheduler';
import { startEntitySmartRetryJob } from '../integrations/core/EntitySmartRetryJob';
import { logger } from '../utils/logger';

/**
 * Jobs de sincronização multi-provider (Fase 2).
 * Espelha o padrão de reservaHospedagemJobs — iniciado no listen da API.
 */
export async function iniciarJobsIntegracaoSync(): Promise<void> {
    // Aguarda init assíncrono do database (mesmo padrão de boot da API).
    await new Promise((r) => setTimeout(r, 2500));
    try {
        bootstrapIntegrationProviders();
        await startIntegrationScheduler();
        startEntitySmartRetryJob();
    } catch (error: any) {
        logger.error('Falha ao iniciar Integration Scheduler', {
            message: error?.message,
            stack: error?.stack,
        });
    }
}
