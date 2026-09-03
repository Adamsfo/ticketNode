/* Harness de testes de integração — mocks Sequelize em memória. */
// @ts-nocheck
import { Op } from 'sequelize';
import {
    HospedinOutboundDesiredAction,
    HospedinOutboundStatus,
    HospedinOutboundSyncState,
} from '../../../models/HospedinOutboundSyncState';
import {
    IntegrationProviderRuntimeStatus,
    IntegrationProviderState,
} from '../../../models/IntegrationProviderState';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { PlaceSuiteMappingStatus } from '../../../models/HospedinPlaceSuiteMap';
import { hospedinPlaceSuiteMapService } from '../services/HospedinPlaceSuiteMapService';
import { OUTBOUND_CLAIMABLE_STATUSES } from './hospedinOutboundClaimable';
import {
    _resetOutboundDispatcherForTests,
    _setOutboundDispatcherTestDeps,
} from './HospedinOutboundDispatcher';
import type { OutboundQueueProbeTestBackend } from './hospedinOutboundQueueProbe';
import {
    _setOutboundQueueProbeTestBackend,
    HOSPEDIN_OUTBOUND_PROVIDER_ID,
} from './hospedinOutboundQueueProbe';
import { hospedinOutboundStateService } from './HospedinOutboundStateService';

export type QueueRow = {
    id: number;
    id_reserva_hospedagem: number;
    outbound_status: string;
    desired_action: string;
    payload_hash: string | null;
    pending_payload_hash: string | null;
    synced_hash_input_json: string | null;
    hospedin_reservation_id: string | null;
    hospedin_guest_id: string | null;
    retry_count: number;
    next_retry_at: Date | null;
    last_error: string | null;
    error_code: string | null;
    last_sync_at: Date | null;
    last_success_at: Date | null;
    processing_started_at: Date | null;
    processing_correlation_id: string | null;
    dirty_at: Date;
    outbound_version: number;
    created_at: Date;
    updated_at: Date;
};

type ReservaFixture = {
    id: number;
    status: string;
    origemReserva: string;
    idExterno: string | null;
    Evento?: { tipo: string };
    ReservaSuite?: Array<{
        idEventoSuite: number;
        ReservaHospede?: Array<{ nome: string }>;
    }>;
};

type SavedModelMocks = {
    syncFindAll: typeof HospedinOutboundSyncState.findAll;
    syncFindOne: typeof HospedinOutboundSyncState.findOne;
    syncFindByPk: typeof HospedinOutboundSyncState.findByPk;
    syncCreate: typeof HospedinOutboundSyncState.create;
    syncUpdate: typeof HospedinOutboundSyncState.update;
    providerFindOne: typeof IntegrationProviderState.findOne;
    reservaFindByPk: typeof ReservaHospedagem.findByPk;
    placeMapFind: typeof hospedinPlaceSuiteMapService.findByEventoSuiteId;
};

function isDue(row: QueueRow, now = new Date()): boolean {
    if (!row.next_retry_at) return true;
    return new Date(row.next_retry_at).getTime() <= now.getTime();
}

function isClaimable(row: QueueRow, now = new Date()): boolean {
    return (
        (OUTBOUND_CLAIMABLE_STATUSES as readonly string[]).includes(
            row.outbound_status
        ) && isDue(row, now)
    );
}

function rowAsModel(row: QueueRow): HospedinOutboundSyncState & {
    update: (patch: Record<string, unknown>) => Promise<HospedinOutboundSyncState>;
} {
    const model = { ...row } as HospedinOutboundSyncState & {
        update: (patch: Record<string, unknown>) => Promise<HospedinOutboundSyncState>;
    };
    model.update = async (patch: Record<string, unknown>) => {
        Object.assign(row, patch, { updated_at: new Date() });
        return model;
    };
    return model;
}

export class OutboundIntegrationStore implements OutboundQueueProbeTestBackend {
    hasPending = false;
    providerEnabled = true;
    providerStatus: string = IntegrationProviderRuntimeStatus.IDLE;
    nextRunAt: Date | null = null;

    readonly queueById = new Map<number, QueueRow>();
    readonly queueByReserva = new Map<number, QueueRow>();
    readonly reservas = new Map<number, ReservaFixture>();

    runCycleCalls: Array<{ provider: string; trigger: string }> = [];
    httpCalls = 0;
    nextQueueId = 1;
    maxConcurrentDispatch = 0;
    private dispatchDepth = 0;

    /** Simula race: insere linha claimable no meio do clear. */
    injectClaimableOnClear: (() => void) | null = null;

    async countClaimableOutbound(): Promise<number> {
        const now = new Date();
        let count = 0;
        for (const row of this.queueById.values()) {
            if (isClaimable(row, now)) count += 1;
        }
        return count;
    }

    async setOutboundHasPendingTrue(): Promise<void> {
        this.hasPending = true;
    }

    async getProviderHasPending(): Promise<boolean> {
        return this.hasPending;
    }

    async tryClearOutboundPendingIfIdle(): Promise<boolean> {
        if (this.injectClaimableOnClear) {
            const hook = this.injectClaimableOnClear;
            this.injectClaimableOnClear = null;
            hook();
        }
        const claimable = await this.countClaimableOutbound();
        if (claimable > 0 || !this.hasPending) {
            return false;
        }
        this.hasPending = false;
        return true;
    }

    seedReserva(input: Partial<ReservaFixture> & { id: number }): void {
        this.reservas.set(input.id, {
            id: input.id,
            status: input.status ?? 'Confirmada',
            origemReserva: input.origemReserva ?? 'ATENDENTE',
            idExterno: input.idExterno ?? null,
            Evento: input.Evento ?? { tipo: 'Pousada' },
            ReservaSuite: input.ReservaSuite ?? [
                {
                    idEventoSuite: 3,
                    ReservaHospede: [{ nome: 'Hospede Teste' }],
                },
            ],
        });
    }

    seedQueueRow(
        input: Partial<QueueRow> & {
            id_reserva_hospedagem: number;
            outbound_status: string;
            desired_action: string;
        }
    ): QueueRow {
        const now = new Date();
        const row: QueueRow = {
            id: input.id ?? this.nextQueueId++,
            id_reserva_hospedagem: input.id_reserva_hospedagem,
            outbound_status: input.outbound_status,
            desired_action: input.desired_action,
            payload_hash: input.payload_hash ?? null,
            pending_payload_hash: input.pending_payload_hash ?? 'hash-test',
            synced_hash_input_json: input.synced_hash_input_json ?? null,
            hospedin_reservation_id: input.hospedin_reservation_id ?? null,
            hospedin_guest_id: input.hospedin_guest_id ?? null,
            retry_count: input.retry_count ?? 0,
            next_retry_at: input.next_retry_at ?? null,
            last_error: input.last_error ?? null,
            error_code: input.error_code ?? null,
            last_sync_at: input.last_sync_at ?? null,
            last_success_at: input.last_success_at ?? null,
            processing_started_at: input.processing_started_at ?? null,
            processing_correlation_id: input.processing_correlation_id ?? null,
            dirty_at: input.dirty_at ?? now,
            outbound_version: input.outbound_version ?? 0,
            created_at: input.created_at ?? now,
            updated_at: input.updated_at ?? now,
        };
        this.queueById.set(row.id, row);
        this.queueByReserva.set(row.id_reserva_hospedagem, row);
        return row;
    }

    getRowByReserva(idReserva: number): QueueRow | undefined {
        return this.queueByReserva.get(idReserva);
    }

    providerStateModel() {
        const store = this;
        return {
            provider: HOSPEDIN_OUTBOUND_PROVIDER_ID,
            hasPending: store.hasPending,
            status: store.providerStatus,
            nextRunAt: store.nextRunAt,
            async update(patch: Record<string, unknown>) {
                if (patch.hasPending != null) {
                    store.hasPending = Boolean(patch.hasPending);
                }
                if (patch.nextRunAt != null) {
                    store.nextRunAt = patch.nextRunAt as Date;
                }
                if (patch.status != null) {
                    store.providerStatus = String(patch.status);
                }
                return store.providerStateModel();
            },
        };
    }

    fakeRunProviderCycle = async (
        providerId: string,
        trigger: string
    ): Promise<{
        skipped: boolean;
        correlationId: string;
        summary: {
            ok: boolean;
            created: number;
            updated: number;
            cancelled: number;
            failed: number;
            skipped: number;
        };
    }> => {
        this.dispatchDepth += 1;
        this.maxConcurrentDispatch = Math.max(
            this.maxConcurrentDispatch,
            this.dispatchDepth
        );
        this.runCycleCalls.push({ provider: providerId, trigger });
        this.httpCalls += 1;

        let created = 0;
        let updated = 0;
        let cancelled = 0;

        try {
            const due = await hospedinOutboundStateService.listDue(30);
            for (const candidate of due) {
                const claimed = await hospedinOutboundStateService.tryClaim(
                    candidate.id,
                    'integration-test'
                );
                if (!claimed) continue;

                const row = this.queueById.get(candidate.id);
                if (!row) continue;

                const action = String(row.desired_action || '').toUpperCase();
                row.outbound_status = HospedinOutboundStatus.SYNCED;
                row.payload_hash = row.pending_payload_hash;
                row.processing_started_at = null;
                row.processing_correlation_id = null;
                row.updated_at = new Date();

                if (action === HospedinOutboundDesiredAction.CREATE) {
                    created += 1;
                } else if (action === HospedinOutboundDesiredAction.CANCEL) {
                    cancelled += 1;
                } else {
                    updated += 1;
                }
            }
        } finally {
            this.dispatchDepth -= 1;
        }

        return {
            skipped: false,
            correlationId: 'integration-test',
            summary: {
                ok: true,
                created,
                updated,
                cancelled,
                failed: 0,
                skipped: 0,
            },
        };
    };

    installMocks(): SavedModelMocks {
        const store = this;
        const saved: SavedModelMocks = {
            syncFindAll: HospedinOutboundSyncState.findAll.bind(
                HospedinOutboundSyncState
            ),
            syncFindOne: HospedinOutboundSyncState.findOne.bind(
                HospedinOutboundSyncState
            ),
            syncFindByPk: HospedinOutboundSyncState.findByPk.bind(
                HospedinOutboundSyncState
            ),
            syncCreate: HospedinOutboundSyncState.create.bind(
                HospedinOutboundSyncState
            ),
            syncUpdate: HospedinOutboundSyncState.update.bind(
                HospedinOutboundSyncState
            ),
            providerFindOne: IntegrationProviderState.findOne.bind(
                IntegrationProviderState
            ),
            reservaFindByPk: ReservaHospedagem.findByPk.bind(ReservaHospedagem),
            placeMapFind:
                hospedinPlaceSuiteMapService.findByEventoSuiteId.bind(
                    hospedinPlaceSuiteMapService
                ),
        };

        HospedinOutboundSyncState.findAll = (async (options: any) => {
            const now = new Date();
            let rows = [...store.queueById.values()];
            const where = options?.where ?? {};
            if (where.outbound_status?.[Op.in]) {
                const allowed = where.outbound_status[Op.in] as string[];
                rows = rows.filter((r) => allowed.includes(r.outbound_status));
            }
            if (where.next_retry_at) {
                rows = rows.filter((r) => isDue(r, now));
            }
            rows.sort(
                (a, b) => a.dirty_at.getTime() - b.dirty_at.getTime()
            );
            if (options?.limit) {
                rows = rows.slice(0, options.limit);
            }
            return rows.map((r) => rowAsModel(r));
        }) as typeof HospedinOutboundSyncState.findAll;

        HospedinOutboundSyncState.findOne = (async (options: any) => {
            const idReserva = options?.where?.id_reserva_hospedagem;
            if (idReserva != null) {
                const row = store.queueByReserva.get(Number(idReserva));
                return row ? rowAsModel(row) : null;
            }
            const id = options?.where?.id;
            if (id != null) {
                const row = store.queueById.get(Number(id));
                return row ? rowAsModel(row) : null;
            }
            return null;
        }) as typeof HospedinOutboundSyncState.findOne;

        HospedinOutboundSyncState.findByPk = (async (id: number) => {
            const row = store.queueById.get(Number(id));
            return row ? rowAsModel(row) : null;
        }) as typeof HospedinOutboundSyncState.findByPk;

        HospedinOutboundSyncState.create = (async (values: any) => {
            const row = store.seedQueueRow({
                id_reserva_hospedagem: values.id_reserva_hospedagem,
                outbound_status: values.outbound_status,
                desired_action: values.desired_action,
                pending_payload_hash: values.pending_payload_hash,
                hospedin_reservation_id: values.hospedin_reservation_id ?? null,
                last_error: values.last_error ?? null,
                error_code: values.error_code ?? null,
                dirty_at: values.dirty_at ?? new Date(),
            });
            return rowAsModel(row);
        }) as typeof HospedinOutboundSyncState.create;

        HospedinOutboundSyncState.update = (async (patch: any, options: any) => {
            const where = options?.where ?? {};
            let affected = 0;
            for (const row of store.queueById.values()) {
                if (where.id != null && row.id !== where.id) continue;
                if (
                    where.outbound_status?.[Op.in] &&
                    !(where.outbound_status[Op.in] as string[]).includes(
                        row.outbound_status
                    )
                ) {
                    continue;
                }
                if (where.next_retry_at) {
                    const or = where.next_retry_at[Op.or];
                    const dueOk = or?.some((clause: any) => {
                        if (clause.next_retry_at === null && !row.next_retry_at) {
                            return true;
                        }
                        if (
                            clause.next_retry_at?.[Op.lte] &&
                            row.next_retry_at &&
                            row.next_retry_at <= clause.next_retry_at[Op.lte]
                        ) {
                            return true;
                        }
                        return false;
                    });
                    if (!dueOk) continue;
                }
                Object.assign(row, patch, { updated_at: new Date() });
                affected += 1;
            }
            return [affected];
        }) as typeof HospedinOutboundSyncState.update;

        IntegrationProviderState.findOne = (async (options: any) => {
            if (
                options?.where?.provider === HOSPEDIN_OUTBOUND_PROVIDER_ID
            ) {
                return store.providerStateModel() as any;
            }
            return saved.providerFindOne(options);
        }) as typeof IntegrationProviderState.findOne;

        ReservaHospedagem.findByPk = (async (id: number) => {
            const row = store.reservas.get(Number(id));
            return (row as any) ?? null;
        }) as typeof ReservaHospedagem.findByPk;

        hospedinPlaceSuiteMapService.findByEventoSuiteId = (async () => ({
            ativo: true,
            mapping_status: PlaceSuiteMappingStatus.LINKED,
            hospedin_place_id: 'place-1',
            hospedin_place_type_id: 'type-1',
        })) as typeof hospedinPlaceSuiteMapService.findByEventoSuiteId;

        _setOutboundQueueProbeTestBackend(store);
        _setOutboundDispatcherTestDeps({
            synchronousSchedule: true,
            runProviderCycle: store.fakeRunProviderCycle,
            getProviderScheduleConfig: async () => ({
                enabled: store.providerEnabled,
                intervalMinutes: 15,
                mode: 'incremental',
                syncLimit: 30,
                priority: 110,
                maxRetries: 5,
                backoffBaseSeconds: 30,
                maxRunMinutes: 10,
                webhookEnabled: false,
                displayName: 'Hospedin Outbound',
            }),
        });

        return saved;
    }

    restoreMocks(saved: SavedModelMocks): void {
        HospedinOutboundSyncState.findAll = saved.syncFindAll;
        HospedinOutboundSyncState.findOne = saved.syncFindOne;
        HospedinOutboundSyncState.findByPk = saved.syncFindByPk;
        HospedinOutboundSyncState.create = saved.syncCreate;
        HospedinOutboundSyncState.update = saved.syncUpdate;
        IntegrationProviderState.findOne = saved.providerFindOne;
        ReservaHospedagem.findByPk = saved.reservaFindByPk;
        hospedinPlaceSuiteMapService.findByEventoSuiteId = saved.placeMapFind;
        _setOutboundQueueProbeTestBackend(null);
        _resetOutboundDispatcherForTests();
    }
}

export async function flushMicrotasks(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
}
