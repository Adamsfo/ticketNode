import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildOperationContext,
    inferRoutineFromStack,
    isAppStackLine,
    poolOperationContextAls,
    snapshotContextForPoolAcquire,
    summarizeStack,
} from './sequelizePoolMonitor';

function fakeStackForRoutine(
    distFile: string,
    fnName: string
): string {
    return `Error
    at buildOperationContext (/home/ubuntu/node/dist/database/sequelizePoolMonitor.js:10:5)
    at ConnectionManager.getConnection (/home/ubuntu/node/node_modules/sequelize/lib/dialects/abstract/connection-manager.js:202:22)
    at Sequelize.query (/home/ubuntu/node/node_modules/sequelize/lib/sequelize.js:305:12)
    at async ${fnName} (/home/ubuntu/node/dist/${distFile}:100:9)
    at async Object.${fnName}Wrapper (/home/ubuntu/node/dist/controllers/ExampleController.js:20:5)`;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('sequelizePoolMonitor — identificação de rotina', () => {
    it('reconhece frame em dist/ (produção)', () => {
        const line =
            '    at listarSituacaoSuites (/home/ubuntu/node/dist/services/hospedagemAdminService.js:2735:20)';
        assert.equal(isAppStackLine(line), true);
        assert.equal(inferRoutineFromStack(`Error\n${line}`), 'listarSituacaoSuites');
    });

    it('diferencia duas operações distintas pelo stack', () => {
        const stackA = fakeStackForRoutine(
            'services/hospedagemAdminService.js',
            'listarSituacaoSuites'
        );
        const stackB = fakeStackForRoutine(
            'jobs/reservaHospedagemJobs.js',
            'cancelarReservasExpiradas'
        );

        const routineA = inferRoutineFromStack(stackA);
        const routineB = inferRoutineFromStack(stackB);

        assert.equal(routineA, 'listarSituacaoSuites');
        assert.equal(routineB, 'cancelarReservasExpiradas');
        assert.notEqual(routineA, routineB);
    });

    it('summarizeStack não usa apenas sequelizePoolMonitor', () => {
        const stack = fakeStackForRoutine(
            'integrations/core/EntitySmartRetryJob.js',
            'tickSmartRetries'
        );
        const summary = summarizeStack(stack);
        assert.equal(summary.includes('buildOperationContext'), false);
        assert.equal(summary.includes('tickSmartRetries'), true);
        assert.equal(summary.includes('dist/integrations'), true);
    });
});

describe('sequelizePoolMonitor — AsyncLocalStorage / concorrência', () => {
    it('snapshot síncrono em pool.acquire preserva contexto por operação', async () => {
        const ctxA = {
            stack: 'stack-A',
            routine: 'RoutineA',
            inTransaction: false,
            kind: 'query' as const,
        };
        const ctxB = {
            stack: 'stack-B',
            routine: 'RoutineB',
            inTransaction: true,
            kind: 'transaction' as const,
        };

        const snapshots: string[] = [];

        await Promise.all([
            poolOperationContextAls.run(ctxA, async () => {
                await delay(15);
                snapshots.push(
                    snapshotContextForPoolAcquire().routine
                );
            }),
            poolOperationContextAls.run(ctxB, async () => {
                await delay(5);
                snapshots.push(
                    snapshotContextForPoolAcquire().routine
                );
            }),
        ]);

        assert.deepEqual(new Set(snapshots), new Set(['RoutineA', 'RoutineB']));
    });

    it('dois getConnection simultâneos (simulados) não trocam rotinas', async () => {
        const simulatePoolAcquire = async (
            routine: string,
            holdMs: number
        ): Promise<string> => {
            const ctx = buildOperationContext({
                kind: 'query',
                inTransaction: false,
            });
            return poolOperationContextAls.run(
                { ...ctx, routine, stack: `stack-${routine}` },
                async () => {
                    await delay(holdMs);
                    const snap = snapshotContextForPoolAcquire();
                    return snap.routine;
                }
            );
        };

        const [r1, r2] = await Promise.all([
            simulatePoolAcquire('listarSituacaoSuites', 20),
            simulatePoolAcquire('HospedinOutboundDispatcher.tick', 3),
        ]);

        assert.equal(r1, 'listarSituacaoSuites');
        assert.equal(r2, 'HospedinOutboundDispatcher.tick');
    });

    it('marca transaction no contexto de sequelize.transaction', () => {
        const ctx = buildOperationContext({
            kind: 'transaction',
            inTransaction: true,
        });
        assert.equal(ctx.inTransaction, true);
        assert.equal(ctx.kind, 'transaction');
        const snap = poolOperationContextAls.run(ctx, () =>
            snapshotContextForPoolAcquire()
        );
        assert.equal(snap.inTransaction, true);
        assert.equal(snap.kind, 'transaction');
    });
});
