import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    inferRoutineFromStack,
    isAppStackLine,
    summarizeStack,
} from './sequelizePoolMonitor';

function fakeStackForRoutine(
    distFile: string,
    fnName: string
): string {
    return `Error
    at captureGetConnectionContext (/home/ubuntu/node/dist/database/sequelizePoolMonitor.js:10:5)
    at ConnectionManager.getConnection (/home/ubuntu/node/node_modules/sequelize/lib/dialects/abstract/connection-manager.js:202:22)
    at Sequelize.query (/home/ubuntu/node/node_modules/sequelize/lib/sequelize.js:305:12)
    at async ${fnName} (/home/ubuntu/node/dist/${distFile}:100:9)
    at async Object.${fnName}Wrapper (/home/ubuntu/node/dist/controllers/ExampleController.js:20:5)`;
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
        assert.equal(summary.includes('captureGetConnectionContext'), false);
        assert.equal(summary.includes('tickSmartRetries'), true);
        assert.equal(summary.includes('dist/integrations'), true);
    });
});
