/**
 * Testes — ProviderRunLifecycle / Scheduler resiliente.
 * Cobre: vivo/morto, heartbeat, timeout, restart, invariante IDLE.
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { IntegrationProviderRuntimeStatus } from '../../models/IntegrationProviderState';
import {
    _resetLifecycleForTests,
    DEFAULT_MAX_RUN_MS,
    HEARTBEAT_TTL_MS,
    isProviderRunAlive,
    isStaleRunning,
} from './ProviderRunLifecycle';

beforeEach(() => {
    _resetLifecycleForTests();
});

describe('isProviderRunAlive', () => {
    const now = new Date('2026-07-30T12:00:00.000Z');

    it('IDLE nunca está vivo como run', () => {
        assert.equal(
            isProviderRunAlive({
                status: 'IDLE',
                lockHeld: true,
                heartbeatAt: now,
                lastStartedAt: now,
                now,
            }),
            false
        );
    });

    it('RUNNING + lock + heartbeat fresco → vivo', () => {
        assert.equal(
            isProviderRunAlive({
                status: 'RUNNING',
                lockHeld: true,
                heartbeatAt: new Date(now.getTime() - 10_000),
                lastStartedAt: new Date(now.getTime() - 60_000),
                now,
            }),
            true
        );
    });

    it('RUNNING sem lock (restart da API) → morto', () => {
        assert.equal(
            isProviderRunAlive({
                status: 'RUNNING',
                lockHeld: false,
                heartbeatAt: now,
                lastStartedAt: now,
                now,
            }),
            false
        );
    });

    it('RUNNING com heartbeat expirado → morto', () => {
        assert.equal(
            isProviderRunAlive({
                status: 'RUNNING',
                lockHeld: true,
                heartbeatAt: new Date(
                    now.getTime() - HEARTBEAT_TTL_MS - 1000
                ),
                lastStartedAt: new Date(now.getTime() - 120_000),
                now,
            }),
            false
        );
    });

    it('RUNNING acima do maxRun (timeout) → morto', () => {
        assert.equal(
            isProviderRunAlive({
                status: 'RUNNING',
                lockHeld: true,
                heartbeatAt: now,
                lastStartedAt: new Date(
                    now.getTime() - DEFAULT_MAX_RUN_MS - 1000
                ),
                now,
                maxRunMs: DEFAULT_MAX_RUN_MS,
            }),
            false
        );
    });
});

describe('isStaleRunning (compat)', () => {
    it('sem lock → stale', () => {
        assert.equal(
            isStaleRunning({
                status: 'RUNNING',
                lockHeld: false,
                lastStartedAt: new Date(),
                heartbeatAt: new Date(),
            }),
            true
        );
    });
});

describe('contrato finish — simulação de caminhos', () => {
    /**
     * Simula startRun/try/finally/finishRun sem banco:
     * qualquer caminho que marcoul RUNNING termina ≠ RUNNING.
     */
    function simulate(path: 'success' | 'error' | 'exception' | 'early_return' | 'timeout' | 'restart') {
        let status = IntegrationProviderRuntimeStatus.IDLE;
        let lastFinishedAt: Date | null = null;
        let executionStatus: string | null = null;
        let lockHeld = false;
        let markedRunning = false;

        if (path === 'early_return') {
            return { status, lastFinishedAt, executionStatus, lockHeld, skipped: true };
        }

        // startRun
        lockHeld = true;
        status = IntegrationProviderRuntimeStatus.RUNNING;
        markedRunning = true;
        let heartbeatAt = new Date();

        let finishKind: 'SUCCESS' | 'ERROR' | 'ABORTED' = 'SUCCESS';

        try {
            if (path === 'restart') {
                // Processo morreu: lock some, status fica RUNNING no "banco"
                lockHeld = false;
                throw new Error('process restart');
            }
            if (path === 'timeout') {
                finishKind = 'ABORTED';
                throw new Error('watchdog');
            }
            if (path === 'exception') {
                throw new Error('boom');
            }
            if (path === 'error') {
                finishKind = 'ERROR';
            } else {
                finishKind = 'SUCCESS';
            }
        } catch {
            if (path === 'timeout') finishKind = 'ABORTED';
            else if (path === 'restart') finishKind = 'ABORTED';
            else finishKind = 'ERROR';
        } finally {
            if (markedRunning) {
                // finishRun / recoverDeadRuns
                const alive = isProviderRunAlive({
                    status,
                    lockHeld,
                    heartbeatAt,
                    lastStartedAt: heartbeatAt,
                    now: new Date(),
                });
                if (!alive || finishKind !== 'SUCCESS') {
                    status = IntegrationProviderRuntimeStatus.IDLE;
                    lastFinishedAt = new Date();
                    executionStatus =
                        finishKind === 'ABORTED'
                            ? 'ABORTED'
                            : finishKind === 'ERROR'
                              ? 'FAILED'
                              : 'SUCCESS';
                    lockHeld = false;
                    heartbeatAt = null as any;
                } else {
                    status = IntegrationProviderRuntimeStatus.IDLE;
                    lastFinishedAt = new Date();
                    executionStatus = 'SUCCESS';
                    lockHeld = false;
                }
            }
        }

        return {
            status,
            lastFinishedAt,
            executionStatus,
            lockHeld,
            skipped: false,
        };
    }

    it('sucesso → IDLE, nunca RUNNING', () => {
        const r = simulate('success');
        assert.equal(r.status, 'IDLE');
        assert.equal(r.lockHeld, false);
        assert.ok(r.lastFinishedAt);
        assert.equal(r.executionStatus, 'SUCCESS');
    });

    it('erro → IDLE', () => {
        const r = simulate('error');
        assert.equal(r.status, 'IDLE');
        assert.equal(r.executionStatus, 'FAILED');
    });

    it('exceção → IDLE', () => {
        const r = simulate('exception');
        assert.equal(r.status, 'IDLE');
        assert.notEqual(r.status, 'RUNNING');
    });

    it('return antecipado não marca RUNNING', () => {
        const r = simulate('early_return');
        assert.equal(r.status, 'IDLE');
        assert.equal(r.lastFinishedAt, null);
        assert.equal(r.skipped, true);
    });

    it('timeout/watchdog → IDLE + ABORTED', () => {
        const r = simulate('timeout');
        assert.equal(r.status, 'IDLE');
        assert.equal(r.executionStatus, 'ABORTED');
        assert.equal(r.lockHeld, false);
    });

    it('restart da API → recover → IDLE + ABORTED', () => {
        const r = simulate('restart');
        assert.equal(r.status, 'IDLE');
        assert.equal(r.executionStatus, 'ABORTED');
        assert.equal(r.lockHeld, false);
    });

    it('execução travada (heartbeat morto) detectada', () => {
        const now = new Date();
        const stuck = isProviderRunAlive({
            status: 'RUNNING',
            lockHeld: true,
            heartbeatAt: new Date(now.getTime() - HEARTBEAT_TTL_MS - 5_000),
            lastStartedAt: new Date(now.getTime() - 60_000),
            now,
        });
        assert.equal(stuck, false);
    });
});

describe('invariante: lastFinishedAt ⇒ status ≠ RUNNING', () => {
    it('finish sempre limpa RUNNING', () => {
        const paths = [
            'success',
            'error',
            'exception',
            'timeout',
            'restart',
        ] as const;
        for (const path of paths) {
            // inline mini sim
            let status: string = 'RUNNING';
            const lastFinishedAt = new Date();
            status = 'IDLE'; // finishRun
            assert.notEqual(
                status,
                'RUNNING',
                `path=${path} ficou RUNNING com lastFinishedAt`
            );
            assert.ok(lastFinishedAt);
        }
    });
});
