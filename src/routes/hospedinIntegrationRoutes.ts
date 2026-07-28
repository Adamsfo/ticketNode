import express from 'express';

const router = express.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const HospedinIntegrationController = require('../controllers/HospedinIntegrationController');

/** Validação de conectividade Hospedin (sem persistência). */
router.get(
    '/api/integrations/hospedin/test',
    authenticate,
    HospedinIntegrationController.test
);

/** Importações staging (não alteram reservas do Jango). */
router.post(
    '/api/integrations/hospedin/import/place-types',
    authenticate,
    HospedinIntegrationController.importPlaceTypes
);

router.post(
    '/api/integrations/hospedin/import/places',
    authenticate,
    HospedinIntegrationController.importPlaces
);

router.post(
    '/api/integrations/hospedin/import/reservations',
    authenticate,
    HospedinIntegrationController.importReservations
);

/** Validação de staging (atualiza IntegrationSyncState; não sincroniza). */
router.post(
    '/api/integrations/hospedin/validate/reservations',
    authenticate,
    HospedinIntegrationController.validateReservations
);

/** Estado persistente de sincronização (sem execução). */
router.get(
    '/api/integrations/hospedin/sync-state',
    authenticate,
    HospedinIntegrationController.listSyncState
);

router.post(
    '/api/integrations/hospedin/sync-state/reprocess',
    authenticate,
    HospedinIntegrationController.reprocessSyncState
);

router.get(
    '/api/integrations/hospedin/sync-state/:id',
    authenticate,
    HospedinIntegrationController.getSyncStateById
);

/** Mapeamento place ↔ EventoSuite (Etapa 4 — sem sync de reservas). */
router.get(
    '/api/integrations/hospedin/mappings/suites',
    authenticate,
    HospedinIntegrationController.listSuiteMappings
);

router.get(
    '/api/integrations/hospedin/mappings/suites/unmapped',
    authenticate,
    HospedinIntegrationController.listUnmappedPlaces
);

router.post(
    '/api/integrations/hospedin/mappings/suites',
    authenticate,
    HospedinIntegrationController.createSuiteMapping
);

router.get(
    '/api/integrations/hospedin/mappings/suites/:id',
    authenticate,
    HospedinIntegrationController.getSuiteMappingById
);

router.put(
    '/api/integrations/hospedin/mappings/suites/:id',
    authenticate,
    HospedinIntegrationController.updateSuiteMapping
);

router.post(
    '/api/integrations/hospedin/mappings/suites/:id/deactivate',
    authenticate,
    HospedinIntegrationController.deactivateSuiteMapping
);

router.post(
    '/api/integrations/hospedin/mappings/suites/:id/activate',
    authenticate,
    HospedinIntegrationController.activateSuiteMapping
);

/** Sync reservas: READY → Orchestrator → Executor (CREATE | UPDATE | CANCEL). */
router.post(
    '/api/integrations/hospedin/sync/reservations',
    authenticate,
    HospedinIntegrationController.syncReservations
);

module.exports = router;
