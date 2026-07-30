/**
 * Contratos genéricos do módulo de integrações (Fase 2).
 * O scheduler só conhece id + runCycle — sem regra de negócio de provider.
 */

import type { IntegrationSyncTriggerValue } from '../../models/IntegrationSyncExecution';

export type SyncRunTrigger = IntegrationSyncTriggerValue | string;

export type SyncRunContext = {
    trigger: SyncRunTrigger;
    correlationId: string;
    mode?: string;
    syncLimit?: number;
    /** Payload opcional de webhook (providers futuros). */
    webhookPayload?: unknown;
};

export type SyncRunSummary = {
    ok: boolean;
    imported?: number;
    validated?: number;
    validatedReady?: number;
    validatedIgnored?: number;
    created?: number;
    updated?: number;
    cancelled?: number;
    failed?: number;
    skipped?: number;
    unchanged?: number;
    errorMessage?: string | null;
    /** Detalhe livre por provider (auditoria). */
    details?: Record<string, unknown>;
};

export type ProviderScheduleConfig = {
    enabled: boolean;
    intervalMinutes: number;
    mode: string;
    syncLimit: number;
    priority: number;
    maxRetries: number;
    backoffBaseSeconds: number;
    /** Watchdog: aborta ciclo acima deste tempo (minutos). Padrão 10. */
    maxRunMinutes: number;
    webhookEnabled: boolean;
    displayName: string;
};

/**
 * Contrato mínimo de um provider de sincronização.
 * Scheduler e webhook disparam o mesmo runCycle.
 */
export interface IntegrationSyncProvider {
    readonly id: string;
    readonly displayName: string;
    /** Defaults vindos de ENV (seed inicial se não houver linha no banco). */
    getEnvDefaults(): Partial<ProviderScheduleConfig> & {
        enabled: boolean;
        intervalMinutes: number;
    };
    runCycle(ctx: SyncRunContext): Promise<SyncRunSummary>;
}

export function computeBackoffMs(
    consecutiveFailures: number,
    backoffBaseSeconds: number,
    maxCapSeconds = 3600
): number {
    const attempt = Math.max(1, consecutiveFailures);
    const seconds = Math.min(
        maxCapSeconds,
        backoffBaseSeconds * Math.pow(2, attempt - 1)
    );
    return Math.floor(seconds * 1000);
}
