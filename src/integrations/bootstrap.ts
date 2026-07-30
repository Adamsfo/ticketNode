import { providerRegistry } from './core/ProviderRegistry';
import { hospedinSyncProvider } from './hospedin/HospedinSyncProvider';

let bootstrapped = false;

/**
 * Registra todos os adapters conhecidos.
 * Novos PMS: import + register aqui (scheduler não muda).
 */
export function bootstrapIntegrationProviders(): void {
    if (bootstrapped) return;
    providerRegistry.register(hospedinSyncProvider);
    bootstrapped = true;
}
