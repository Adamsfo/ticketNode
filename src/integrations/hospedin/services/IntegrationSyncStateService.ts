import { createHash, randomUUID } from 'crypto';
import { Op } from 'sequelize';
import {
    IntegrationEntityType,
    IntegrationProvider,
    IntegrationSyncState,
    IntegrationSyncStatus,
    type IntegrationEntityTypeValue,
    type IntegrationProviderValue,
    type IntegrationSyncStatusValue,
} from '../../../models/IntegrationSyncState';
import { HospedinLogger } from '../logger/HospedinLogger';
import { hospedinSyncLogService } from './HospedinSyncLogService';

export type FindIdentityInput = {
    provider: IntegrationProviderValue | string;
    entityType: IntegrationEntityTypeValue | string;
    externalId: string | number;
};

export type UpsertStateInput = FindIdentityInput & {
    validationStatus?: string | null;
    syncAction?: string | null;
    syncStatus?: IntegrationSyncStatusValue | string;
    payloadHash?: string | null;
    lastError?: string | null;
    internalEntityId?: string | null;
    touchValidation?: boolean;
    touchSync?: boolean;
    incrementRetry?: boolean;
    /** Incrementa sync_version somente em aplicação efetiva (CREATE/UPDATE/CANCEL). */
    incrementSyncVersion?: boolean;
    correlationId?: string | null;
    reason?: string;
    operacao?: string;
};

/**
 * Controle persistente do estado de sincronização.
 * Sem regras de sync com o Jango — apenas CRUD/estado.
 */
export class IntegrationSyncStateService {
    async findByIdentity(
        input: FindIdentityInput
    ): Promise<IntegrationSyncState | null> {
        return IntegrationSyncState.findOne({
            where: {
                provider: input.provider,
                entity_type: input.entityType,
                external_id: String(input.externalId),
            },
        });
    }

    async findById(id: number): Promise<IntegrationSyncState | null> {
        return IntegrationSyncState.findByPk(id);
    }

    async list(filters?: {
        provider?: string;
        entityType?: string;
        syncStatus?: string | string[];
        limit?: number;
        offset?: number;
    }): Promise<IntegrationSyncState[]> {
        const where: Record<string, unknown> = {};
        if (filters?.provider) where.provider = filters.provider;
        if (filters?.entityType) where.entity_type = filters.entityType;
        if (filters?.syncStatus) {
            where.sync_status = Array.isArray(filters.syncStatus)
                ? { [Op.in]: filters.syncStatus }
                : filters.syncStatus;
        }

        return IntegrationSyncState.findAll({
            where,
            order: [['updated_at', 'DESC']],
            limit: filters?.limit ?? 100,
            offset: filters?.offset ?? 0,
        });
    }

    async findByStatus(
        syncStatus: IntegrationSyncStatusValue | string,
        options?: { provider?: string; entityType?: string; limit?: number }
    ): Promise<IntegrationSyncState[]> {
        return this.list({
            provider: options?.provider,
            entityType: options?.entityType,
            syncStatus,
            limit: options?.limit ?? 200,
        });
    }

    async findReady(options?: {
        provider?: string;
        entityType?: string;
        limit?: number;
    }): Promise<IntegrationSyncState[]> {
        return this.findByStatus(IntegrationSyncStatus.READY, options);
    }

    async findFailed(options?: {
        provider?: string;
        entityType?: string;
        limit?: number;
    }): Promise<IntegrationSyncState[]> {
        return this.findByStatus(IntegrationSyncStatus.FAILED, options);
    }

    async findWaitMapping(options?: {
        provider?: string;
        entityType?: string;
        limit?: number;
    }): Promise<IntegrationSyncState[]> {
        return this.findByStatus(IntegrationSyncStatus.WAIT_MAPPING, options);
    }

    async createNew(input: FindIdentityInput): Promise<IntegrationSyncState> {
        const now = new Date();
        const row = await IntegrationSyncState.create({
            provider: input.provider,
            entity_type: input.entityType,
            external_id: String(input.externalId),
            correlation_id: randomUUID(),
            sync_status: IntegrationSyncStatus.NEW,
            retry_count: 0,
            sync_version: 0,
            created_at: now,
            updated_at: now,
        });

        await this.logTransition({
            state: row,
            previousStatus: null,
            nextStatus: IntegrationSyncStatus.NEW,
            reason: 'Registro criado',
            operacao: 'sync_state_create',
        });

        return row;
    }

    async findOrCreate(
        input: FindIdentityInput
    ): Promise<IntegrationSyncState> {
        const existing = await this.findByIdentity(input);
        if (existing) return existing;
        return this.createNew(input);
    }

    async updateState(input: UpsertStateInput): Promise<IntegrationSyncState> {
        const state = await this.findOrCreate(input);
        const previousStatus = state.sync_status;
        const now = new Date();

        const nextStatus = input.syncStatus ?? state.sync_status;
        const patch: Partial<IntegrationSyncState> = {
            updated_at: now,
        };

        if (input.validationStatus !== undefined) {
            patch.validation_status = input.validationStatus;
        }
        if (input.syncAction !== undefined) {
            patch.sync_action = input.syncAction;
        }
        if (input.syncStatus !== undefined) {
            patch.sync_status = input.syncStatus;
        }
        if (input.payloadHash !== undefined) {
            patch.payload_hash = input.payloadHash;
        }
        if (input.internalEntityId !== undefined) {
            patch.internal_entity_id = input.internalEntityId;
        }
        if (input.lastError !== undefined) {
            patch.last_error = input.lastError;
        }
        if (input.correlationId) {
            patch.correlation_id = input.correlationId;
        }
        if (input.touchValidation) {
            patch.last_validation_at = now;
        }
        if (input.touchSync) {
            patch.last_sync_at = now;
        }
        if (input.incrementRetry) {
            patch.retry_count = Number(state.retry_count || 0) + 1;
        }
        if (input.incrementSyncVersion) {
            patch.sync_version = Number(state.sync_version || 0) + 1;
        }

        await state.update(patch);

        if (String(previousStatus) !== String(nextStatus)) {
            await this.logTransition({
                state,
                previousStatus: String(previousStatus),
                nextStatus: String(nextStatus),
                reason: input.reason || 'Atualização de estado',
                operacao: input.operacao || 'sync_state_update',
            });
        }

        return state;
    }

    async setStatus(
        input: FindIdentityInput & {
            syncStatus: IntegrationSyncStatusValue | string;
            reason?: string;
            lastError?: string | null;
            syncAction?: string | null;
            validationStatus?: string | null;
            payloadHash?: string | null;
            touchValidation?: boolean;
            incrementRetry?: boolean;
        }
    ): Promise<IntegrationSyncState> {
        return this.updateState({
            ...input,
            operacao: 'sync_state_set_status',
        });
    }

    async incrementRetry(
        input: FindIdentityInput & { reason?: string; lastError?: string | null }
    ): Promise<IntegrationSyncState> {
        return this.updateState({
            ...input,
            incrementRetry: true,
            lastError: input.lastError ?? null,
            reason: input.reason || 'Incremento de retry',
            operacao: 'sync_state_retry',
        });
    }

    async markSynced(
        input: FindIdentityInput & {
            internalEntityId: string;
            reason?: string;
            /** true = alteração efetiva aplicada (CREATE / UPDATE com mudanças / CANCEL). */
            incrementSyncVersion?: boolean;
        }
    ): Promise<IntegrationSyncState> {
        return this.updateState({
            ...input,
            syncStatus: IntegrationSyncStatus.SYNCED,
            internalEntityId: input.internalEntityId,
            lastError: null,
            touchSync: true,
            incrementSyncVersion: input.incrementSyncVersion === true,
            reason: input.reason || 'Sincronização concluída',
            operacao: 'sync_state_synced',
        });
    }

    async markError(
        input: FindIdentityInput & {
            error: string;
            reason?: string;
            validationStatus?: string | null;
        }
    ): Promise<IntegrationSyncState> {
        return this.updateState({
            ...input,
            syncStatus: IntegrationSyncStatus.FAILED,
            lastError: input.error,
            validationStatus: input.validationStatus,
            incrementRetry: true,
            reason: input.reason || input.error,
            operacao: 'sync_state_error',
        });
    }

    async updatePayloadHash(
        input: FindIdentityInput & { payloadHash: string }
    ): Promise<IntegrationSyncState> {
        return this.updateState({
            ...input,
            payloadHash: input.payloadHash,
            reason: 'Atualização de payload_hash',
            operacao: 'sync_state_payload_hash',
        });
    }

    async reprocessToReady(
        id: number,
        reason = 'Reprocessamento administrativo'
    ): Promise<IntegrationSyncState> {
        const state = await this.findById(id);
        if (!state) {
            throw new Error(`IntegrationSyncState id=${id} não encontrado.`);
        }

        return this.updateState({
            provider: state.provider,
            entityType: state.entity_type,
            externalId: state.external_id,
            syncStatus: IntegrationSyncStatus.READY,
            lastError: null,
            reason,
            operacao: 'sync_state_reprocess',
        });
    }

    hashPayload(payload: unknown): string {
        const raw =
            typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
        return createHash('sha256').update(raw).digest('hex');
    }

    private async logTransition(input: {
        state: IntegrationSyncState;
        previousStatus: string | null;
        nextStatus: string;
        reason: string;
        operacao: string;
    }): Promise<void> {
        HospedinLogger.info('sync_state:transition', {
            id: input.state.id,
            provider: input.state.provider,
            entity_type: input.state.entity_type,
            external_id: input.state.external_id,
            correlation_id: input.state.correlation_id,
            sync_version: input.state.sync_version,
            previousStatus: input.previousStatus,
            nextStatus: input.nextStatus,
            reason: input.reason,
            data: new Date().toISOString(),
        });

        await hospedinSyncLogService.write({
            operacao: input.operacao,
            endpoint: null,
            metodo: null,
            request: {
                id: input.state.id,
                external_id: input.state.external_id,
                correlation_id: input.state.correlation_id,
                sync_version: input.state.sync_version,
            },
            response: {
                previousStatus: input.previousStatus,
                nextStatus: input.nextStatus,
                sync_version: input.state.sync_version,
                reason: input.reason,
            },
            status: 200,
            duracaoMs: 0,
            sucesso: true,
        });
    }
}

export const integrationSyncStateService = new IntegrationSyncStateService();

export {
    IntegrationProvider,
    IntegrationEntityType,
    IntegrationSyncStatus,
};
