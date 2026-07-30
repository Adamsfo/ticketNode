import express from 'express';

const router = express.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const IntegrationAdminController = require('../controllers/IntegrationAdminController');

/**
 * APIs genéricas do módulo de integrações (qualquer provider).
 * Hospedin Import/Validate/Sync específicos continuam em hospedinIntegrationRoutes.
 */

router.get(
    '/api/integrations/status',
    authenticate,
    IntegrationAdminController.listStatus
);

router.get(
    '/api/integrations/sync-summary',
    authenticate,
    IntegrationAdminController.syncSummary
);

router.get(
    '/api/integrations/pendencias',
    authenticate,
    IntegrationAdminController.listPendencias
);

router.post(
    '/api/integrations/pendencias/reconcile',
    authenticate,
    IntegrationAdminController.reconcilePendencias
);

router.get(
    '/api/integrations/entity-events',
    authenticate,
    IntegrationAdminController.listEntityEvents
);

router.get(
    '/api/integrations/reservas/:internalId/sync-state',
    authenticate,
    IntegrationAdminController.getEntityStateByInternal
);

router.post(
    '/api/integrations/:provider/entities/run-bulk',
    authenticate,
    IntegrationAdminController.runEntityBulk
);

router.post(
    '/api/integrations/:provider/entities/:externalId/run',
    authenticate,
    IntegrationAdminController.runEntity
);

router.get(
    '/api/integrations/:provider/entities/:externalId',
    authenticate,
    IntegrationAdminController.getEntityState
);

router.get(
    '/api/integrations/executions',
    authenticate,
    IntegrationAdminController.listExecutions
);

router.get(
    '/api/integrations/executions/:id',
    authenticate,
    IntegrationAdminController.getExecution
);

router.get(
    '/api/integrations/:provider/execution-stats',
    authenticate,
    IntegrationAdminController.executionStats
);

router.post(
    '/api/integrations/:provider/run',
    authenticate,
    IntegrationAdminController.runNow
);

/** Webhook genérico — mesmo runCycle do scheduler (force). */
router.post(
    '/api/integrations/:provider/webhook',
    authenticate,
    IntegrationAdminController.webhook
);

router.patch(
    '/api/integrations/:provider/config',
    authenticate,
    IntegrationAdminController.patchConfig
);

/** Promove HÓSPEDE SEM CPF → Usuario com CPF a partir de ReservaHospedeDocumento. */
router.post(
    '/api/integrations/guests/reconcile-cpf',
    authenticate,
    IntegrationAdminController.reconcileGuestCpf
);

module.exports = router;
