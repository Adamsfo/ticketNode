import { providerRegistry } from './core/ProviderRegistry';
import { hospedinSyncProvider } from './hospedin/HospedinSyncProvider';
import { hospedinOutboundSyncProvider } from './hospedin/outbound/HospedinOutboundSyncProvider';

let bootstrapped = false;

/**
 * Registra todos os adapters conhecidos.
 * Novos PMS: import + register aqui (scheduler não muda).
 */
export function bootstrapIntegrationProviders(): void {
    if (bootstrapped) return;
    providerRegistry.register(hospedinSyncProvider);
    providerRegistry.register(hospedinOutboundSyncProvider);
    bootstrapped = true;
}
