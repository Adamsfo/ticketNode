import type { IntegrationSyncProvider } from './types';

/**
 * Registro de providers. Novos PMS = nova implementação + register().
 * O scheduler não importa Hospedin/Booking diretamente.
 */
class ProviderRegistry {
    private readonly providers = new Map<string, IntegrationSyncProvider>();

    register(provider: IntegrationSyncProvider): void {
        const id = String(provider.id || '')
            .trim()
            .toUpperCase();
        if (!id) {
            throw new Error('IntegrationSyncProvider.id é obrigatório.');
        }
        this.providers.set(id, provider);
    }

    get(providerId: string): IntegrationSyncProvider | null {
        return (
            this.providers.get(String(providerId || '').trim().toUpperCase()) ||
            null
        );
    }

    list(): IntegrationSyncProvider[] {
        return Array.from(this.providers.values());
    }

    ids(): string[] {
        return Array.from(this.providers.keys());
    }
}

export const providerRegistry = new ProviderRegistry();
