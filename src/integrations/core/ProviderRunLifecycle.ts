/**
 * Ciclo de vida do provider — ÚNICO dono de RUNNING → IDLE.
 *
 * startRun()  → RUNNING + heartbeat + watchdog + lock
 * finishRun() → SUCCESS|ERROR|ABORTED na execution + status IDLE + unlock
 * recoverDeadRuns() → boot/tick: heartbeat expirado / sem lock / timeout
 *
 * Nenhum outro módulo deve atualizar integration_provider_state.status
 * para RUNNING/IDLE durante um ciclo.
 */

import { logger, logOperationalError } from '../../utils/logger';
import {
    IntegrationProviderRuntimeStatus,
    IntegrationProviderState,
} from '../../models/IntegrationProviderState';
import {
    IntegrationSyncExecution,
    IntegrationSyncExecutionStatus,
    type IntegrationSyncExecutionStatusValue,
    type IntegrationSyncTriggerValue,
} from '../../models/IntegrationSyncExecution';
import {
    createRunningExecution,
    finishExecution,
    resolveExecutionStatus,
} from './ExecutionHistoryService';
import { providerRunLock } from './ProviderRunLock';
import {
    computeBackoffMs,
    type ProviderScheduleConfig,
    type SyncRunSummary,
} from './types';

const log = logger.child('ProviderRunLifecycle');

/** Intervalo de heartbeat enquanto o ciclo está vivo neste processo. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Sem heartbeat fresco = processo morto.
 * 3 intervalos sem update (90s) → considerado morto.
 */
export const HEARTBEAT_TTL_MS = 90_000;

/** Watchdog padrão se config.maxRunMinutes ausente. */
export const DEFAULT_MAX_RUN_MS = 10 * 60_000;

export type RunFinishKind =
    | 'SUCCESS'
    | 'PARTIAL'
    | 'FAILED'
    | 'ERROR'
    | 'ABORTED';

export type ActiveRunHandle = {
    provider: string;
    state: IntegrationProviderState;
    execution: IntegrationSyncExecution;
    config: ProviderScheduleConfig;
    startedAt: Date;
    abortController: AbortController;
    /** true após finishRun — idempotente. */
    finished: boolean;
};

export type FinishRunInput = {
    handle: ActiveRunHandle;
    kind: RunFinishKind;
    summary?: SyncRunSummary | null;
    errorMessage?: string | null;
};

/**
 * Decide se um RUNNING no banco ainda está vivo neste processo.
 * Morto se: sem lock OR heartbeat expirado OR duração > maxRun.
 */
export function isProviderRunAlive(input: {
    status: string;
    lockHeld: boolean;
    heartbeatAt?: Date | null;
    lastStartedAt?: Date | null;
    now?: Date;
    heartbeatTtlMs?: number;
    maxRunMs?: number;
}): boolean {
    if (input.status !== IntegrationProviderRuntimeStatus.RUNNING) {
        return false;
    }
    if (!input.lockHeld) return false;

    const now = (input.now || new Date()).getTime();
    const ttl = input.heartbeatTtlMs ?? HEARTBEAT_TTL_MS;
    const maxRun = input.maxRunMs ?? DEFAULT_MAX_RUN_MS;

    const started = input.lastStartedAt
        ? new Date(input.lastStartedAt).getTime()
        : 0;
    if (started && now - started >= maxRun) return false;

    const hb = input.heartbeatAt
        ? new Date(input.heartbeatAt).getTime()
        : started;
    if (!hb) return false;
    if (now - hb >= ttl) return false;

    return true;
}

/** @deprecated use isProviderRunAlive — mantido para testes antigos. */
export function isStaleRunning(input: {
    status: string;
    lastStartedAt?: Date | null;
    heartbeatAt?: Date | null;
    lockHeld: boolean;
    now?: Date;
    staleMs?: number;
    heartbeatTtlMs?: number;
}): boolean {
    if (input.status !== IntegrationProviderRuntimeStatus.RUNNING) return false;
    return !isProviderRunAlive({
        status: input.status,
        lockHeld: input.lockHeld,
        heartbeatAt: input.heartbeatAt,
        lastStartedAt: input.lastStartedAt,
        now: input.now,
        heartbeatTtlMs: input.heartbeatTtlMs,
        maxRunMs: input.staleMs,
    });
}

function maxRunMsFromConfig(config: ProviderScheduleConfig): number {
    const mins = Math.max(1, Number(config.maxRunMinutes) || 10);
    return mins * 60_000;
}

function computeNextRunAt(
    config: ProviderScheduleConfig,
    consecutiveFailures: number,
    finishedAt: Date,
    failed: boolean
): Date | null {
    if (!config.enabled) return null;
    if (failed && consecutiveFailures > 0 && config.maxRetries > 0) {
        const useRetry = consecutiveFailures <= config.maxRetries;
        if (useRetry) {
            const backoffMs = computeBackoffMs(
                consecutiveFailures,
                config.backoffBaseSeconds
            );
            return new Date(finishedAt.getTime() + backoffMs);
        }
    }
    return new Date(finishedAt.getTime() + config.intervalMinutes * 60_000);
}

const activeHandles = new Map<string, ActiveRunHandle>();
const heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();
const watchdogTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimers(provider: string) {
    const hb = heartbeatTimers.get(provider);
    if (hb) {
        clearInterval(hb);
        heartbeatTimers.delete(provider);
    }
    const wd = watchdogTimers.get(provider);
    if (wd) {
        clearTimeout(wd);
        watchdogTimers.delete(provider);
    }
}

async function touchHeartbeat(state: IntegrationProviderState): Promise<void> {
    const now = new Date();
    await state.update({ heartbeatAt: now });
}

/**
 * Único ponto que coloca o provider em RUNNING.
 * Adquire lock, cria execution, inicia heartbeat + watchdog.
 */
export async function startRun(input: {
    provider: string;
    trigger: IntegrationSyncTriggerValue | string;
    mode: string;
    correlationId: string;
    config: ProviderScheduleConfig;
}): Promise<ActiveRunHandle> {
    const provider = String(input.provider || '')
        .trim()
        .toUpperCase();

    if (!providerRunLock.tryAcquire(provider)) {
        throw new Error(
            `Lock indisponível para ${provider} — execução já em andamento.`
        );
    }

    try {
        let state =
            (await IntegrationProviderState.findOne({
                where: { provider },
            })) ||
            (await IntegrationProviderState.create({
                provider,
                status: IntegrationProviderRuntimeStatus.IDLE,
                consecutiveFailures: 0,
            }));

        const now = new Date();
        await state.update({
            status: IntegrationProviderRuntimeStatus.RUNNING,
            lastStartedAt: now,
            heartbeatAt: now,
            lastErrorMessage: null,
        });
        await state.reload();

        const execution = await createRunningExecution({
            provider,
            trigger: input.trigger,
            mode: input.mode,
            correlationId: input.correlationId,
        });
        await state.update({ lastExecutionId: execution.id });

        const handle: ActiveRunHandle = {
            provider,
            state,
            execution,
            config: input.config,
            startedAt: now,
            abortController: new AbortController(),
            finished: false,
        };
        activeHandles.set(provider, handle);

        heartbeatTimers.set(
            provider,
            setInterval(() => {
                void touchHeartbeat(handle.state).catch((err) => {
                    log.warn(`${provider}: heartbeat falhou`, {
                        message: (err as Error)?.message,
                    });
                });
            }, HEARTBEAT_INTERVAL_MS)
        );
        // Evita manter o processo vivo só por causa do heartbeat.
        heartbeatTimers.get(provider)?.unref?.();

        const maxMs = maxRunMsFromConfig(input.config);
        watchdogTimers.set(
            provider,
            setTimeout(() => {
                void onWatchdogTimeout(provider);
            }, maxMs)
        );
        watchdogTimers.get(provider)?.unref?.();

        return handle;
    } catch (err) {
        providerRunLock.release(provider);
        clearTimers(provider);
        activeHandles.delete(provider);
        throw err;
    }
}

async function onWatchdogTimeout(provider: string): Promise<void> {
    const handle = activeHandles.get(provider);
    if (!handle || handle.finished) return;

    log.warn(`${provider}: watchdog — execução abandonada (timeout)`, {
        maxRunMinutes: handle.config.maxRunMinutes,
        startedAt: handle.startedAt.toISOString(),
    });

    handle.abortController.abort();
    await finishRun({
        handle,
        kind: 'ABORTED',
        errorMessage: `Execução abandonada (timeout). Status anterior: RUNNING. Limite: ${handle.config.maxRunMinutes || 10} min.`,
        summary: {
            ok: false,
            errorMessage: `Execução abandonada (timeout ${handle.config.maxRunMinutes || 10}min).`,
        },
    });
}

/**
 * Único ponto que finaliza o ciclo.
 * Sempre: execution finalizada + status IDLE|DISABLED + lock liberado.
 * Idempotente se já finalizado (ex.: watchdog + runCycle concluem juntos).
 */
export async function finishRun(input: FinishRunInput): Promise<void> {
    const { handle } = input;
    if (handle.finished) return;
    handle.finished = true;

    clearTimers(handle.provider);
    activeHandles.delete(handle.provider);

    const finishedAt = new Date();
    const durationMs = Math.max(
        0,
        finishedAt.getTime() - handle.startedAt.getTime()
    );

    let execStatus: IntegrationSyncExecutionStatusValue =
        IntegrationSyncExecutionStatus.FAILED;
    let consecutiveFailures = handle.state.consecutiveFailures || 0;
    let lastErrorMessage: string | null = input.errorMessage ?? null;
    let lastSuccessAt: Date | undefined;
    let lastErrorAt: Date | undefined;
    let failedForBackoff = false;

    try {
        if (input.kind === 'ABORTED') {
            execStatus = IntegrationSyncExecutionStatus.ABORTED;
            failedForBackoff = true;
            consecutiveFailures += 1;
            lastErrorAt = finishedAt;
            lastErrorMessage =
                input.errorMessage ||
                'Execução abandonada (timeout/restart).';
            await handle.execution.update({
                finishedAt,
                durationMs,
                status: execStatus,
                errorMessage: lastErrorMessage,
            });
        } else if (input.kind === 'ERROR') {
            execStatus = IntegrationSyncExecutionStatus.FAILED;
            failedForBackoff = true;
            consecutiveFailures += 1;
            lastErrorAt = finishedAt;
            lastErrorMessage =
                input.errorMessage ||
                input.summary?.errorMessage ||
                'Erro no ciclo.';
            await finishExecution(
                handle.execution,
                input.summary || { ok: false, errorMessage: lastErrorMessage },
                execStatus
            );
        } else {
            const summary = input.summary || { ok: true };
            execStatus =
                input.kind === 'SUCCESS' || input.kind === 'PARTIAL'
                    ? input.kind === 'PARTIAL'
                        ? IntegrationSyncExecutionStatus.PARTIAL
                        : resolveExecutionStatus(summary)
                    : resolveExecutionStatus(summary);

            if (input.kind === 'FAILED' || !summary.ok) {
                execStatus = IntegrationSyncExecutionStatus.FAILED;
                failedForBackoff = true;
                consecutiveFailures += 1;
                lastErrorAt = finishedAt;
                lastErrorMessage =
                    summary.errorMessage ||
                    input.errorMessage ||
                    'Falha no ciclo.';
            } else if (execStatus === IntegrationSyncExecutionStatus.PARTIAL) {
                lastErrorAt = finishedAt;
                lastErrorMessage =
                    summary.errorMessage ||
                    `${summary.failed || 0} falha(s) no lote`;
                consecutiveFailures = 0;
            } else {
                consecutiveFailures = 0;
                lastSuccessAt = finishedAt;
                lastErrorMessage = null;
            }

            await finishExecution(handle.execution, summary, execStatus);
        }
    } catch (err: any) {
        logOperationalError({
            provider: handle.provider,
            stage: 'FINISH_EXECUTION',
            message: err?.message || 'Falha ao finalizar execution.',
            stack: err?.stack,
        });
        try {
            await handle.execution.update({
                finishedAt,
                durationMs,
                status: IntegrationSyncExecutionStatus.ABORTED,
                errorMessage:
                    lastErrorMessage ||
                    err?.message ||
                    'Falha ao finalizar execution.',
            });
        } catch {
            /* ignore */
        }
        failedForBackoff = true;
        consecutiveFailures += 1;
        lastErrorAt = finishedAt;
    }

    // Provider SEMPRE sai de RUNNING → IDLE (ou DISABLED).
    const terminalStatus = handle.config.enabled
        ? IntegrationProviderRuntimeStatus.IDLE
        : IntegrationProviderRuntimeStatus.DISABLED;

    const nextRunAt = computeNextRunAt(
        handle.config,
        consecutiveFailures,
        finishedAt,
        failedForBackoff
    );

    try {
        const payload: Record<string, unknown> = {
            status: terminalStatus,
            lastFinishedAt: finishedAt,
            lastDurationMs: durationMs,
            consecutiveFailures,
            nextRunAt,
            lastExecutionId: handle.execution.id,
            heartbeatAt: null,
            lastErrorMessage,
        };
        if (lastSuccessAt) payload.lastSuccessAt = lastSuccessAt;
        if (lastErrorAt) payload.lastErrorAt = lastErrorAt;
        await handle.state.update(payload);
    } catch (err: any) {
        logOperationalError({
            provider: handle.provider,
            stage: 'FINISH_STATE',
            message: err?.message || 'Falha ao gravar IDLE — tentativa final.',
            stack: err?.stack,
        });
        try {
            await handle.state.update({
                status: IntegrationProviderRuntimeStatus.IDLE,
                lastFinishedAt: finishedAt,
                heartbeatAt: null,
                nextRunAt: finishedAt,
                lastErrorMessage:
                    err?.message || 'Falha na finalização — forçado IDLE.',
            });
        } catch {
            /* ignore */
        }
    } finally {
        providerRunLock.release(handle.provider);
    }
}

/**
 * Recupera RUNNING mortos (restart, crash, heartbeat expirado, timeout).
 * Chamado no boot do scheduler e a cada tick.
 */
export async function recoverDeadRuns(options?: {
    now?: Date;
    heartbeatTtlMs?: number;
}): Promise<{ recovered: string[]; checked: number }> {
    const now = options?.now || new Date();
    const rows = await IntegrationProviderState.findAll({
        where: { status: IntegrationProviderRuntimeStatus.RUNNING },
    });
    const recovered: string[] = [];

    for (const state of rows) {
        const provider = String(state.provider || '').toUpperCase();
        const lockHeld = providerRunLock.isLocked(provider);
        const active = activeHandles.get(provider);

        // Ainda vivo neste processo (heartbeat + lock + dentro do maxRun).
        const configMaxMs = active
            ? maxRunMsFromConfig(active.config)
            : DEFAULT_MAX_RUN_MS;

        if (
            isProviderRunAlive({
                status: String(state.status),
                lockHeld,
                heartbeatAt: state.heartbeatAt,
                lastStartedAt: state.lastStartedAt,
                now,
                heartbeatTtlMs: options?.heartbeatTtlMs,
                maxRunMs: configMaxMs,
            })
        ) {
            continue;
        }

        const reason = !lockHeld
            ? 'RUNNING órfão (sem lock em memória) — restart/crash.'
            : 'RUNNING morto (heartbeat expirado ou timeout).';

        log.warn(`${provider}: recuperando execução morta`, {
            reason,
            lastStartedAt: state.lastStartedAt,
            heartbeatAt: state.heartbeatAt,
        });

        // Se há handle local, finaliza via finishRun (idempotente).
        if (active && !active.finished) {
            active.abortController.abort();
            await finishRun({
                handle: active,
                kind: 'ABORTED',
                errorMessage: `Execução abandonada. ${reason}`,
            });
            recovered.push(provider);
            continue;
        }

        // Sem handle (restart): aborta execution no banco + IDLE.
        if (state.lastExecutionId) {
            const execution = await IntegrationSyncExecution.findByPk(
                state.lastExecutionId
            );
            if (
                execution &&
                execution.status === IntegrationSyncExecutionStatus.RUNNING
            ) {
                const finishedAt = now;
                const durationMs = Math.max(
                    0,
                    finishedAt.getTime() -
                        new Date(execution.startedAt).getTime()
                );
                await execution.update({
                    status: IntegrationSyncExecutionStatus.ABORTED,
                    finishedAt,
                    durationMs,
                    errorMessage: `Execução abandonada. ${reason}`,
                });
            }
        }

        await state.update({
            status: IntegrationProviderRuntimeStatus.IDLE,
            lastFinishedAt: now,
            lastErrorAt: now,
            lastErrorMessage: `Execução abandonada. ${reason}`,
            heartbeatAt: null,
            nextRunAt: now,
        });

        // Garante lock limpo.
        providerRunLock.release(provider);
        clearTimers(provider);
        activeHandles.delete(provider);
        recovered.push(provider);
    }

    return { recovered, checked: rows.length };
}

/** Alias — API estável para o scheduler. */
export const recoverStaleRunningProviders = recoverDeadRuns;

export function mapOutcomeToFinishKind(
    execStatus: IntegrationSyncExecutionStatusValue
): RunFinishKind {
    if (execStatus === IntegrationSyncExecutionStatus.SUCCESS) return 'SUCCESS';
    if (execStatus === IntegrationSyncExecutionStatus.PARTIAL) return 'PARTIAL';
    if (execStatus === IntegrationSyncExecutionStatus.ABORTED) return 'ABORTED';
    return 'FAILED';
}

/** Exposto para testes. */
export function _resetLifecycleForTests() {
    for (const p of [...activeHandles.keys()]) {
        clearTimers(p);
        providerRunLock.release(p);
    }
    activeHandles.clear();
}
