import { Op } from 'sequelize';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundStatus,
    HospedinOutboundSyncState,
} from '../../../models/HospedinOutboundSyncState';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { DEFAULT_MAX_RUN_MS } from '../../core/ProviderRunLifecycle';
import { computeBackoffMs } from '../../core/types';
import {
    resolveCreateFinalizeDecision,
    type CreateFinalizeSnapshot,
} from './hospedinOutboundCreateFinalize';
import { OUTBOUND_CLAIMABLE_STATUSES } from './hospedinOutboundClaimable';
import { notifyOutboundPendingIfClaimable } from './hospedinOutboundDispatchTrigger';

const CLAIMABLE_STATUSES = OUTBOUND_CLAIMABLE_STATUSES;

function pendingStatusFromDesiredAction(
    desiredAction: string | null | undefined
): string {
    const action = String(desiredAction || '').toUpperCase();
    if (action === HospedinOutboundDesiredAction.UPDATE) {
        return HospedinOutboundStatus.PENDING_UPDATE;
    }
    if (action === HospedinOutboundDesiredAction.CANCEL) {
        return HospedinOutboundStatus.PENDING_CANCEL;
    }
    return HospedinOutboundStatus.PENDING_CREATE;
}

/** Exposto para testes — mapeia desired_action → outbound_status pendente. */
export function resolvePendingOutboundStatus(
    desiredAction: string | null | undefined
): string {
    return pendingStatusFromDesiredAction(desiredAction);
}

function retryDueWhere(now: Date) {
    return {
        [Op.or]: [
            { next_retry_at: null },
            { next_retry_at: { [Op.lte]: now } },
        ],
    };
}

/**
 * Estado da fila outbound — isolado de integration_sync_state (inbound).
 */
export class HospedinOutboundStateService {
    /** TTL alinhado ao watchdog padrão do scheduler (10 min). */
    static readonly STALE_PROCESSING_MS = DEFAULT_MAX_RUN_MS;

    async listDue(limit: number): Promise<HospedinOutboundSyncState[]> {
        const safeLimit = Math.max(1, Math.floor(limit || 1));
        const now = new Date();

        return HospedinOutboundSyncState.findAll({
            where: {
                outbound_status: { [Op.in]: [...CLAIMABLE_STATUSES] },
                ...retryDueWhere(now),
            },
            order: [['dirty_at', 'ASC']],
            limit: safeLimit,
        });
    }

    /**
     * Claim atômico por UPDATE condicional.
     * Retorna true somente se affectedRows === 1.
     */
    async tryClaim(id: number, correlationId: string): Promise<boolean> {
        const rowId = Number(id);
        if (!Number.isFinite(rowId) || rowId <= 0) return false;

        const now = new Date();
        const [affected] = await HospedinOutboundSyncState.update(
            {
                outbound_status: HospedinOutboundStatus.PROCESSING,
                processing_started_at: now,
                processing_correlation_id: String(correlationId || '').slice(
                    0,
                    64
                ),
                updated_at: now,
            },
            {
                where: {
                    id: rowId,
                    outbound_status: { [Op.in]: [...CLAIMABLE_STATUSES] },
                    ...retryDueWhere(now),
                },
            }
        );

        return Number(affected) === 1;
    }

    async releaseToPending(
        id: number,
        options?: { desiredAction?: string }
    ): Promise<void> {
        const rowId = Number(id);
        if (!Number.isFinite(rowId) || rowId <= 0) return;

        const row = await HospedinOutboundSyncState.findByPk(rowId);
        if (!row) return;

        const now = new Date();
        const outbound_status = pendingStatusFromDesiredAction(
            options?.desiredAction ?? row.desired_action
        );

        await row.update({
            outbound_status,
            processing_started_at: null,
            processing_correlation_id: null,
            updated_at: now,
        });
        await notifyOutboundPendingIfClaimable(outbound_status);
    }

    async markSynced(
        id: number,
        input?: {
            hospedinReservationId?: string | null;
            hospedinGuestId?: string | null;
            syncedHashInputJson?: string | null;
        }
    ): Promise<void> {
        const row = await HospedinOutboundSyncState.findByPk(id);
        if (!row) return;

        const now = new Date();
        const patch: Record<string, unknown> = {
            outbound_status: HospedinOutboundStatus.SYNCED,
            payload_hash: row.pending_payload_hash ?? row.payload_hash,
            last_sync_at: now,
            last_success_at: now,
            processing_started_at: null,
            processing_correlation_id: null,
            last_error: null,
            error_code: null,
            next_retry_at: null,
            updated_at: now,
            outbound_version: Number(row.outbound_version || 0) + 1,
        };

        if (input?.hospedinReservationId != null) {
            patch.hospedin_reservation_id = input.hospedinReservationId;
        }
        if (input?.hospedinGuestId != null) {
            patch.hospedin_guest_id = input.hospedinGuestId;
        }
        if (input?.syncedHashInputJson != null) {
            patch.synced_hash_input_json = input.syncedHashInputJson;
        }

        await row.update(patch);
    }

    async markWaitRetry(
        id: number,
        input: {
            errorMessage: string;
            errorCode?: string | null;
            retryCount: number;
            backoffBaseSeconds: number;
        }
    ): Promise<void> {
        const row = await HospedinOutboundSyncState.findByPk(id);
        if (!row) return;

        const now = new Date();
        const retryCount = Math.max(0, Number(input.retryCount) || 0);
        const backoffMs = computeBackoffMs(
            retryCount,
            Math.max(1, Number(input.backoffBaseSeconds) || 30)
        );

        await row.update({
            outbound_status: HospedinOutboundStatus.WAIT_RETRY,
            retry_count: retryCount,
            next_retry_at: new Date(now.getTime() + backoffMs),
            last_error: input.errorMessage,
            error_code: input.errorCode ?? null,
            processing_started_at: null,
            processing_correlation_id: null,
            updated_at: now,
        });
        await notifyOutboundPendingIfClaimable(
            HospedinOutboundStatus.WAIT_RETRY
        );
    }

    async markFailed(
        id: number,
        input: {
            errorMessage: string;
            errorCode?: string | null;
            hospedinReservationId?: string | null;
            hospedinGuestId?: string | null;
        }
    ): Promise<void> {
        const row = await HospedinOutboundSyncState.findByPk(id);
        if (!row) return;

        const now = new Date();
        const patch: Record<string, unknown> = {
            outbound_status: HospedinOutboundStatus.FAILED,
            last_error: input.errorMessage,
            error_code: input.errorCode ?? null,
            processing_started_at: null,
            processing_correlation_id: null,
            updated_at: now,
        };

        if (input.hospedinReservationId != null) {
            patch.hospedin_reservation_id = input.hospedinReservationId;
        }
        if (input.hospedinGuestId != null) {
            patch.hospedin_guest_id = input.hospedinGuestId;
        }

        await row.update(patch);
    }

    async markBlocked(
        id: number,
        input: { errorMessage: string; errorCode?: string | null }
    ): Promise<void> {
        const row = await HospedinOutboundSyncState.findByPk(id);
        if (!row) return;

        const now = new Date();
        await row.update({
            outbound_status: HospedinOutboundStatus.BLOCKED,
            last_error: input.errorMessage,
            error_code: input.errorCode ?? null,
            processing_started_at: null,
            processing_correlation_id: null,
            updated_at: now,
        });
    }

    /**
     * CREATE outbound abortado — reserva cancelada no Jango antes do POST Hospedin.
     */
    async markAborted(
        id: number,
        input?: { errorMessage?: string | null; errorCode?: string | null }
    ): Promise<void> {
        const row = await HospedinOutboundSyncState.findByPk(id);
        if (!row) return;

        const now = new Date();
        await row.update({
            outbound_status: HospedinOutboundStatus.ABORTED,
            desired_action: HospedinOutboundDesiredAction.CANCEL,
            last_error: input?.errorMessage ?? null,
            error_code: input?.errorCode ?? 'CREATE_ABORTED',
            processing_started_at: null,
            processing_correlation_id: null,
            next_retry_at: null,
            retry_count: 0,
            updated_at: now,
        });
    }

    /**
     * Enfileira cancelamento outbound (Jango já cancelada, vínculo Hospedin existe).
     */
    async markPendingCancel(
        id: number,
        input?: {
            hospedinReservationId?: string | null;
            hospedinGuestId?: string | null;
        }
    ): Promise<void> {
        const row = await HospedinOutboundSyncState.findByPk(id);
        if (!row) return;

        const now = new Date();
        const patch: Record<string, unknown> = {
            outbound_status: HospedinOutboundStatus.PENDING_CANCEL,
            desired_action: HospedinOutboundDesiredAction.CANCEL,
            dirty_at: now,
            last_error: null,
            error_code: null,
            next_retry_at: null,
            processing_started_at: null,
            processing_correlation_id: null,
            updated_at: now,
        };

        if (input?.hospedinReservationId != null) {
            patch.hospedin_reservation_id = input.hospedinReservationId;
        }
        if (input?.hospedinGuestId != null) {
            patch.hospedin_guest_id = input.hospedinGuestId;
        }

        await row.update(patch);
        await notifyOutboundPendingIfClaimable(
            HospedinOutboundStatus.PENDING_CANCEL
        );
    }

    private buildCreateFinalizeSnapshot(
        row: HospedinOutboundSyncState,
        jangoStatus?: string | null
    ): CreateFinalizeSnapshot {
        return {
            jangoStatus: jangoStatus ?? null,
            desiredAction: row.desired_action,
            outboundStatus: row.outbound_status,
        };
    }

    /**
     * Finaliza CREATE após POST: recarrega Jango + fila e evita sobrescrever
     * PENDING_CANCEL com SYNCED (compare-and-set).
     */
    async finalizeCreateAfterPost(
        id: number,
        input: {
            hospedinReservationId: string;
            hospedinGuestId: string;
            syncedHashInputJson: string;
        }
    ): Promise<'synced' | 'pending_cancel'> {
        const rowId = Number(id);
        const row = await HospedinOutboundSyncState.findByPk(rowId);
        if (!row) {
            return 'pending_cancel';
        }

        const reserva = await ReservaHospedagem.findByPk(
            row.id_reserva_hospedagem,
            { attributes: ['status'] }
        );
        const snapshot = this.buildCreateFinalizeSnapshot(
            row,
            reserva?.status ?? null
        );

        if (resolveCreateFinalizeDecision(snapshot) === 'pending_cancel') {
            await this.markPendingCancel(rowId, {
                hospedinReservationId: input.hospedinReservationId,
                hospedinGuestId: input.hospedinGuestId,
            });
            return 'pending_cancel';
        }

        const now = new Date();
        const syncedPatch: Record<string, unknown> = {
            outbound_status: HospedinOutboundStatus.SYNCED,
            payload_hash: row.pending_payload_hash ?? row.payload_hash,
            synced_hash_input_json: input.syncedHashInputJson,
            hospedin_reservation_id: input.hospedinReservationId,
            hospedin_guest_id: input.hospedinGuestId,
            last_sync_at: now,
            last_success_at: now,
            processing_started_at: null,
            processing_correlation_id: null,
            last_error: null,
            error_code: null,
            next_retry_at: null,
            updated_at: now,
            outbound_version: Number(row.outbound_version || 0) + 1,
        };

        const [affected] = await HospedinOutboundSyncState.update(syncedPatch, {
            where: {
                id: rowId,
                outbound_status: HospedinOutboundStatus.PROCESSING,
                desired_action: {
                    [Op.ne]: HospedinOutboundDesiredAction.CANCEL,
                },
            },
        });

        if (Number(affected) === 1) {
            return 'synced';
        }

        const recheckRow = await HospedinOutboundSyncState.findByPk(rowId);
        if (!recheckRow) {
            return 'pending_cancel';
        }

        if (recheckRow.outbound_status === HospedinOutboundStatus.SYNCED) {
            return 'synced';
        }

        await this.markPendingCancel(rowId, {
            hospedinReservationId: input.hospedinReservationId,
            hospedinGuestId: input.hospedinGuestId,
        });
        return 'pending_cancel';
    }

    /**
     * Persistência imediata de IDs Hospedin após POST (antes de markSynced).
     */
    async persistHospedinIds(
        id: number,
        input: {
            hospedinReservationId?: string | null;
            hospedinGuestId?: string | null;
        }
    ): Promise<void> {
        const row = await HospedinOutboundSyncState.findByPk(id);
        if (!row) return;

        const patch: Record<string, unknown> = { updated_at: new Date() };
        if (input.hospedinReservationId != null) {
            patch.hospedin_reservation_id = input.hospedinReservationId;
        }
        if (input.hospedinGuestId != null) {
            patch.hospedin_guest_id = input.hospedinGuestId;
        }

        if (Object.keys(patch).length > 1) {
            await row.update(patch);
        }
    }

    /**
     * Recupera PROCESSING órfãos (restart, crash, timeout).
     * PROCESSING → PENDING_CREATE | PENDING_UPDATE conforme desired_action.
     */
    async recoverStaleProcessing(options?: {
        now?: Date;
        staleMs?: number;
    }): Promise<{ recovered: number; checked: number }> {
        const now = options?.now ?? new Date();
        const staleMs =
            options?.staleMs ?? HospedinOutboundStateService.STALE_PROCESSING_MS;
        const cutoff = new Date(now.getTime() - staleMs);

        const rows = await HospedinOutboundSyncState.findAll({
            where: {
                outbound_status: HospedinOutboundStatus.PROCESSING,
                processing_started_at: { [Op.lt]: cutoff },
            },
        });

        for (const row of rows) {
            const outbound_status = pendingStatusFromDesiredAction(
                row.desired_action
            );
            await row.update({
                outbound_status,
                processing_started_at: null,
                processing_correlation_id: null,
                updated_at: now,
            });
            await notifyOutboundPendingIfClaimable(outbound_status);
        }

        return { recovered: rows.length, checked: rows.length };
    }
}

export const hospedinOutboundStateService = new HospedinOutboundStateService();
