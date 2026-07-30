/**
 * Lock em memória por provider — impede duas syncs simultâneas do mesmo PMS.
 * Providers diferentes podem rodar em paralelo.
 */
class ProviderRunLock {
    private readonly locks = new Map<string, boolean>();

    tryAcquire(providerId: string): boolean {
        const key = String(providerId || '').trim().toUpperCase();
        if (!key) return false;
        if (this.locks.get(key)) return false;
        this.locks.set(key, true);
        return true;
    }

    release(providerId: string): void {
        const key = String(providerId || '').trim().toUpperCase();
        this.locks.delete(key);
    }

    isLocked(providerId: string): boolean {
        const key = String(providerId || '').trim().toUpperCase();
        return Boolean(this.locks.get(key));
    }
}

export const providerRunLock = new ProviderRunLock();
