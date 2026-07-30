import { Op, fn, col, literal } from 'sequelize';
import {
    IntegrationEntityType,
    IntegrationSyncState,
    IntegrationSyncStatus,
} from '../../models/IntegrationSyncState';
import { HospedinReservation } from '../../models/HospedinReservation';
import {
    labelSeverity,
    mapSyncStatusToUi,
    SyncResolutionStatus,
    type SyncUiStatus,
} from './syncErrorClassification';
import { openErrorWhere } from './PendenciaReconcileService';
import {
    getExecutionVolumeStats,
    getLatestFinishedExecution,
    mapExecutionRow,
    type ExecutionVolumeStats,
} from './ExecutionHistoryService';

export type SyncSummaryLastExecution = {
    id: number;
    provider: string;
    status: string;
    triggerSource: string;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    imported: number | null;
    validated: number | null;
    validatedReady: number | null;
    validatedIgnored: number | null;
    created: number | null;
    updated: number | null;
    cancelled: number | null;
    failed: number | null;
    skipped: number | null;
    unchanged: number | null;
    ignored: number | null;
    errorMessage: string | null;
};

export type SyncSummarySaude = {
    ativa: boolean;
    ultimaExecucaoAt: string | null;
    ultimaExecucaoHaMs: number | null;
    execucoes: number;
    reservasSincronizadas: number;
    mensagem: string;
};

export type SyncSummaryCounts = {
    /**
     * Pendências OPEN com reserva Jango (internal_entity_id preenchido).
     * Mesma regra do filtro Reservas → "Falhas sync".
     */
    erros: number;
    /**
     * Pendências OPEN sem reserva criada (internal_entity_id NULL).
     * Só aparecem em Integrações → Pendências.
     */
    errosSemReserva: number;
    /** erros + errosSemReserva (badge / atenção total). */
    errosTotal: number;
    criticos: number;
    alertas: number;
    informativos: number;
    pendentes: number;
    processando: number;
    sincronizadas: number;
    ignoradas: number;
    aguardandoSync: number;
    ultimoErro: string | null;
    ultimaSincronizacaoSucesso: string | null;
    /** Última execução (integration_sync_execution). */
    lastExecution: SyncSummaryLastExecution | null;
    /** Acumulado desde o início (SUM/COUNT). */
    acumulado: ExecutionVolumeStats;
    /** Indicador de que o scheduler está trabalhando. */
    saude: SyncSummarySaude;
};

export type SyncStateView = {
    provider: string;
    externalId: string;
    internalEntityId: string | null;
    syncStatus: string;
    uiStatus: SyncUiStatus | null;
    syncAction: string | null;
    lastError: string | null;
    errorCode: string | null;
    errorSeverity: string | null;
    errorSeverityLabel: string | null;
    resolutionStatus: string | null;
    retryCount: number;
    lastSyncAt: string | null;
    lastSuccessAt: string | null;
    nextRetryAt: string | null;
    validationStatus: string | null;
};

function toIso(d?: Date | string | null): string | null {
    if (!d) return null;
    try {
        return new Date(d).toISOString();
    } catch {
        return null;
    }
}

function mapState(row: IntegrationSyncState): SyncStateView {
    const severity = (row as any).error_severityity ?? null;
    return {
        provider: String(row.provider),
        externalId: String(row.external_id),
        internalEntityId: row.internal_entity_id
            ? String(row.internal_entity_id)
            : null,
        syncStatus: String(row.sync_status),
        uiStatus: mapSyncStatusToUi(row.sync_status),
        syncAction: row.sync_action ? String(row.sync_action) : null,
        lastError: row.last_error ?? null,
        errorCode: (row as any).error_code ?? null,
        errorSeverity: severity,
        errorSeverityLabel: severity ? labelSeverity(severity) : null,
        resolutionStatus: (row as any).resolution_status ?? null,
        retryCount: Number(row.retry_count || 0),
        lastSyncAt: toIso(row.last_sync_at),
        lastSuccessAt: toIso((row as any).last_success_at),
        nextRetryAt: toIso((row as any).next_retry_at),
        validationStatus: row.validation_status
            ? String(row.validation_status)
            : null,
    };
}

export async function getSyncSummaryCounts(
    provider?: string
): Promise<SyncSummaryCounts> {
    const whereBase: Record<string, unknown> = {
        entity_type: IntegrationEntityType.RESERVATION,
    };
    if (provider) whereBase.provider = provider.toUpperCase();

    // Contagens gerais por sync_status (visão ampla)
    const rows = await IntegrationSyncState.findAll({
        attributes: [
            'sync_status',
            [fn('COUNT', col('id')), 'total'],
        ],
        where: whereBase,
        group: ['sync_status'],
        raw: true,
    });

    const byStatus: Record<string, number> = {};
    for (const r of rows as any[]) {
        const status = String(r.sync_status || '').toUpperCase();
        byStatus[status] = Number(r.total || 0);
    }

    // Erros com reserva Jango (= filtro Reservas "Falhas sync")
    const openWhere = openErrorWhere(provider);
    const openComReserva = {
        ...openWhere,
        internal_entity_id: { [Op.ne]: null },
    };
    const openSemReserva = {
        ...openWhere,
        [Op.or]: [{ internal_entity_id: null }, { internal_entity_id: '' }],
    };

    const erros = await IntegrationSyncState.count({ where: openComReserva });
    const errosSemReserva = await IntegrationSyncState.count({
        where: openSemReserva,
    });
    const errosTotal = erros + errosSemReserva;

    // Severidade sobre o total OPEN (com + sem reserva) — visão Integrações
    const criticos = await IntegrationSyncState.count({
        where: { ...openWhere, error_severityity: 'CRITICAL' },
    });
    const alertas = await IntegrationSyncState.count({
        where: { ...openWhere, error_severityity: 'ALERT' },
    });
    const informativos = await IntegrationSyncState.count({
        where: { ...openWhere, error_severityity: 'INFO' },
    });

    const pendentes =
        (byStatus[IntegrationSyncStatus.NEW] || 0) +
        (byStatus[IntegrationSyncStatus.VALIDATED] || 0) +
        (byStatus[IntegrationSyncStatus.READY] || 0) +
        (byStatus[IntegrationSyncStatus.QUEUED] || 0);
    const processando = byStatus[IntegrationSyncStatus.SYNCING] || 0;
    const sincronizadas = byStatus[IntegrationSyncStatus.SYNCED] || 0;
    const ignoradas = byStatus[IntegrationSyncStatus.IGNORED] || 0;
    const aguardandoSync = byStatus[IntegrationSyncStatus.READY] || 0;

    const lastErr = await IntegrationSyncState.findOne({
        where: openWhere,
        order: [['updated_at', 'DESC']],
    });

    const lastOk = await IntegrationSyncState.findOne({
        where: {
            ...whereBase,
            sync_status: IntegrationSyncStatus.SYNCED,
        },
        order: [
            [literal('COALESCE(last_success_at, last_sync_at)'), 'DESC'],
        ],
    });

    const [acumulado, latestExec] = await Promise.all([
        getExecutionVolumeStats(provider),
        getLatestFinishedExecution(provider),
    ]);

    const lastExecution: SyncSummaryLastExecution | null = latestExec
        ? (() => {
              const mapped = mapExecutionRow(latestExec);
              const ignored =
                  Number(mapped.validatedIgnored || 0) +
                  Number(mapped.skipped || 0);
              return {
                  id: mapped.id,
                  provider: String(mapped.provider || latestExec.provider),
                  status: String(mapped.status),
                  triggerSource: String(mapped.triggerSource),
                  startedAt: toIso(mapped.startedAt as any) || '',
                  finishedAt: toIso(mapped.finishedAt as any),
                  durationMs: mapped.durationMs,
                  imported: mapped.imported,
                  validated: mapped.validated,
                  validatedReady: mapped.validatedReady,
                  validatedIgnored: mapped.validatedIgnored,
                  created: mapped.created,
                  updated: mapped.updated,
                  cancelled: mapped.cancelled,
                  failed: mapped.failed,
                  skipped: mapped.skipped,
                  unchanged: mapped.unchanged,
                  ignored,
                  errorMessage: mapped.errorMessage,
              };
          })()
        : null;

    const ultimaExecucaoAt =
        lastExecution?.finishedAt || lastExecution?.startedAt || null;
    const ultimaExecucaoHaMs = ultimaExecucaoAt
        ? Math.max(0, Date.now() - new Date(ultimaExecucaoAt).getTime())
        : null;
    const ativa =
        acumulado.execucoes > 0 &&
        (ultimaExecucaoHaMs == null ||
            ultimaExecucaoHaMs < 24 * 60 * 60 * 1000);

    let mensagem = 'Nenhuma sincronização registrada ainda.';
    if (acumulado.execucoes > 0 && ultimaExecucaoHaMs != null) {
        mensagem = `Integração ativa · última sincronização ${formatHaMs(ultimaExecucaoHaMs)}`;
    } else if (acumulado.execucoes > 0) {
        mensagem = 'Integração com histórico de execuções.';
    }

    return {
        erros,
        errosSemReserva,
        errosTotal,
        criticos,
        alertas,
        informativos,
        pendentes,
        processando,
        sincronizadas,
        ignoradas,
        aguardandoSync,
        ultimoErro: lastErr?.last_error ?? null,
        ultimaSincronizacaoSucesso: toIso(
            (lastOk as any)?.last_success_at || lastOk?.last_sync_at
        ),
        lastExecution,
        acumulado,
        saude: {
            ativa,
            ultimaExecucaoAt,
            ultimaExecucaoHaMs,
            execucoes: acumulado.execucoes,
            reservasSincronizadas: acumulado.reservasSincronizadas,
            mensagem,
        },
    };
}

function formatHaMs(ms: number): string {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `há ${sec} segundo${sec === 1 ? '' : 's'}`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `há ${min} minuto${min === 1 ? '' : 's'}`;
    const h = Math.floor(min / 60);
    if (h < 48) return `há ${h} hora${h === 1 ? '' : 's'}`;
    const d = Math.floor(h / 24);
    return `há ${d} dia${d === 1 ? '' : 's'}`;
}

export async function getSyncStatesByInternalIds(
    internalIds: Array<string | number>
): Promise<Map<string, SyncStateView>> {
    const map = new Map<string, SyncStateView>();
    const ids = internalIds
        .map((id) => String(id))
        .filter((id) => id && id !== 'null');
    if (ids.length === 0) return map;

    const rows = await IntegrationSyncState.findAll({
        where: {
            entity_type: IntegrationEntityType.RESERVATION,
            internal_entity_id: { [Op.in]: ids },
        },
    });
    for (const row of rows) {
        if (row.internal_entity_id) {
            map.set(String(row.internal_entity_id), mapState(row));
        }
    }
    return map;
}

export async function getSyncStateByInternalId(
    internalId: number | string
): Promise<SyncStateView | null> {
    const row = await IntegrationSyncState.findOne({
        where: {
            entity_type: IntegrationEntityType.RESERVATION,
            internal_entity_id: String(internalId),
        },
        order: [['updated_at', 'DESC']],
    });
    return row ? mapState(row) : null;
}

export async function getSyncStateByExternalId(
    provider: string,
    externalId: string | number
): Promise<SyncStateView | null> {
    const row = await IntegrationSyncState.findOne({
        where: {
            provider: provider.toUpperCase(),
            entity_type: IntegrationEntityType.RESERVATION,
            external_id: String(externalId),
        },
    });
    return row ? mapState(row) : null;
}

export type PendenciaItem = {
    provider: string;
    externalId: string;
    internalEntityId: string | null;
    syncStatus: string;
    uiStatus: SyncUiStatus | null;
    syncAction: string | null;
    errorCode: string | null;
    errorSeverity: string | null;
    errorSeverityLabel: string | null;
    lastError: string | null;
    retryCount: number;
    lastSyncAt: string | null;
    nextRetryAt: string | null;
    /** Dados de staging (quando CREATE ainda não gerou reserva Jango). */
    staging?: {
        searchableCode?: string | null;
        checkin?: string | null;
        checkout?: string | null;
        status?: string | null;
        guestName?: string | null;
    } | null;
};

/**
 * Lista pendências operacionais abertas (resolution=OPEN).
 * Histórico / IGNORED / RESOLVED nunca entram aqui.
 */
export async function listSyncPendencias(options?: {
    provider?: string;
    severity?: string;
    limit?: number;
    offset?: number;
}): Promise<{ total: number; items: PendenciaItem[] }> {
    const where: Record<string, unknown> = openErrorWhere(options?.provider);
    if (options?.severity) {
        where.error_severityity = options.severity.toUpperCase();
    }

    const total = await IntegrationSyncState.count({ where });
    const rows = await IntegrationSyncState.findAll({
        where,
        order: [
            [
                literal(
                    `FIELD(error_severityity, 'CRITICAL', 'ALERT', 'INFO')`
                ),
                'ASC',
            ],
            ['updated_at', 'DESC'],
        ],
        limit: Math.min(200, Math.max(1, options?.limit ?? 50)),
        offset: Math.max(0, options?.offset ?? 0),
    });

    const externalIds = rows.map((r) => Number(r.external_id)).filter(Boolean);
    const stagingRows =
        externalIds.length > 0
            ? await HospedinReservation.findAll({
                  where: { reservation_id: { [Op.in]: externalIds } },
              })
            : [];
    const stagingById = new Map(
        stagingRows.map((s) => [Number(s.reservation_id), s])
    );

    const items: PendenciaItem[] = rows.map((row) => {
        const base = mapState(row);
        const st = stagingById.get(Number(row.external_id));
        const payload = (st?.payload_json || {}) as Record<string, unknown>;
        const guest =
            (payload.main_guest as Record<string, unknown>) ||
            (payload.guest as Record<string, unknown>) ||
            null;

        return {
            provider: base.provider,
            externalId: base.externalId,
            internalEntityId: base.internalEntityId,
            syncStatus: base.syncStatus,
            uiStatus: base.uiStatus,
            syncAction: base.syncAction,
            errorCode: base.errorCode,
            errorSeverity: base.errorSeverity,
            errorSeverityLabel: base.errorSeverityLabel,
            lastError: base.lastError,
            retryCount: base.retryCount,
            lastSyncAt: base.lastSyncAt,
            nextRetryAt: base.nextRetryAt,
            staging: st
                ? {
                      searchableCode:
                          (st as any).searchable_code ||
                          (payload.searchable_code as string) ||
                          null,
                      checkin: st.checkin ? String(st.checkin) : null,
                      checkout: st.checkout ? String(st.checkout) : null,
                      status: st.status ? String(st.status) : null,
                      guestName: guest
                          ? String(
                                guest.name ||
                                    guest.full_name ||
                                    guest.nome ||
                                    ''
                            ) || null
                          : null,
                  }
                : null,
        };
    });

    return { total, items };
}

/**
 * IDs de ReservaHospedagem com falha OPEN.
 * Mesma regra de negócio de SyncSummaryCounts.erros / filtro "Falhas sync".
 */
export async function findInternalIdsWithSyncError(
    limit = 500
): Promise<number[]> {
    const rows = await IntegrationSyncState.findAll({
        attributes: ['internal_entity_id'],
        where: {
            ...openErrorWhere(),
            internal_entity_id: { [Op.ne]: null },
        },
        limit,
    });
    return rows
        .map((r) => Number(r.internal_entity_id))
        .filter((id) => Number.isFinite(id) && id > 0);
}
