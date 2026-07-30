import { randomUUID } from 'crypto';
import { IntegrationProviderConfig } from '../../models/IntegrationProviderConfig';
import {
    IntegrationProviderRuntimeStatus,
    IntegrationProviderState,
} from '../../models/IntegrationProviderState';
import { providerRegistry } from './ProviderRegistry';
import type { ProviderScheduleConfig } from './types';

function envFlag(value: string | undefined, fallback = false): boolean {
    if (value == null || value === '') return fallback;
    const v = value.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function envInt(
    value: string | undefined,
    fallback: number,
    min = 1
): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min) return fallback;
    return Math.floor(n);
}

/**
 * Garante linhas de config/state para cada provider registrado.
 * ENV só preenche na primeira criação — depois o banco prevalece.
 */
export async function ensureProviderConfigsFromRegistry(): Promise<void> {
    for (const provider of providerRegistry.list()) {
        const id = provider.id.toUpperCase();
        const defaults = provider.getEnvDefaults();
        let config = await IntegrationProviderConfig.findOne({
            where: { provider: id },
        });
        if (!config) {
            config = await IntegrationProviderConfig.create({
                provider: id,
                displayName:
                    defaults.displayName || provider.displayName || id,
                enabled: Boolean(defaults.enabled),
                intervalMinutes: Math.max(
                    1,
                    Number(defaults.intervalMinutes) || 5
                ),
                mode: defaults.mode || 'incremental',
                syncLimit: Math.max(1, Number(defaults.syncLimit) || 50),
                priority: Number(defaults.priority) || 100,
                maxRetries: Math.max(0, Number(defaults.maxRetries) ?? 2),
                backoffBaseSeconds: Math.max(
                    1,
                    Number(defaults.backoffBaseSeconds) || 30
                ),
                webhookEnabled: Boolean(defaults.webhookEnabled),
            });
        }

        let state = await IntegrationProviderState.findOne({
            where: { provider: id },
        });
        if (!state) {
            const nextRunAt = config.enabled
                ? new Date(Date.now() + config.intervalMinutes * 60_000)
                : null;
            state = await IntegrationProviderState.create({
                provider: id,
                status: config.enabled
                    ? IntegrationProviderRuntimeStatus.IDLE
                    : IntegrationProviderRuntimeStatus.DISABLED,
                nextRunAt,
                consecutiveFailures: 0,
            });
        } else if (!config.enabled) {
            await state.update({
                status: IntegrationProviderRuntimeStatus.DISABLED,
            });
        } else if (
            state.status === IntegrationProviderRuntimeStatus.DISABLED
        ) {
            await state.update({
                status: IntegrationProviderRuntimeStatus.IDLE,
                nextRunAt:
                    state.nextRunAt ||
                    new Date(Date.now() + config.intervalMinutes * 60_000),
            });
        }
    }
}

export async function getProviderScheduleConfig(
    providerId: string
): Promise<ProviderScheduleConfig | null> {
    const id = String(providerId || '')
        .trim()
        .toUpperCase();
    const row = await IntegrationProviderConfig.findOne({
        where: { provider: id },
    });
    if (!row) return null;
    return {
        enabled: Boolean(row.enabled),
        intervalMinutes: row.intervalMinutes,
        mode: row.mode || 'incremental',
        syncLimit: row.syncLimit,
        priority: row.priority,
        maxRetries: row.maxRetries,
        backoffBaseSeconds: row.backoffBaseSeconds,
        webhookEnabled: Boolean(row.webhookEnabled),
        displayName: row.displayName,
    };
}

export async function updateProviderConfig(
    providerId: string,
    patch: Partial<{
        enabled: boolean;
        intervalMinutes: number;
        mode: string;
        syncLimit: number;
        priority: number;
        maxRetries: number;
        backoffBaseSeconds: number;
        webhookEnabled: boolean;
        displayName: string;
    }>
): Promise<IntegrationProviderConfig | null> {
    const id = String(providerId || '')
        .trim()
        .toUpperCase();
    const row = await IntegrationProviderConfig.findOne({
        where: { provider: id },
    });
    if (!row) return null;

    const next: Record<string, unknown> = {};
    if (patch.enabled != null) next.enabled = Boolean(patch.enabled);
    if (patch.intervalMinutes != null) {
        next.intervalMinutes = Math.max(1, Math.floor(patch.intervalMinutes));
    }
    if (patch.mode != null) next.mode = String(patch.mode);
    if (patch.syncLimit != null) {
        next.syncLimit = Math.max(1, Math.floor(patch.syncLimit));
    }
    if (patch.priority != null) next.priority = Math.floor(patch.priority);
    if (patch.maxRetries != null) {
        next.maxRetries = Math.max(0, Math.floor(patch.maxRetries));
    }
    if (patch.backoffBaseSeconds != null) {
        next.backoffBaseSeconds = Math.max(
            1,
            Math.floor(patch.backoffBaseSeconds)
        );
    }
    if (patch.webhookEnabled != null) {
        next.webhookEnabled = Boolean(patch.webhookEnabled);
    }
    if (patch.displayName != null) next.displayName = String(patch.displayName);

    await row.update(next);

    const state = await IntegrationProviderState.findOne({
        where: { provider: id },
    });
    if (state) {
        if (patch.enabled === false) {
            await state.update({
                status: IntegrationProviderRuntimeStatus.DISABLED,
            });
        } else if (
            patch.enabled === true &&
            state.status === IntegrationProviderRuntimeStatus.DISABLED
        ) {
            await state.update({
                status: IntegrationProviderRuntimeStatus.IDLE,
                nextRunAt: new Date(
                    Date.now() + row.intervalMinutes * 60_000
                ),
            });
        }
    }

    return row;
}

/** Helpers ENV usados pelos adapters no getEnvDefaults(). */
export const providerEnvHelpers = { envFlag, envInt };

export function newCorrelationId(prefix = 'sync'): string {
    return `${prefix}-${randomUUID()}`;
}
