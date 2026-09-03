import express from 'express';

const router = express.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const LimpezaSuitesController = require('../controllers/LimpezaSuitesController');

router.get(
    '/limpeza/suites',
    authenticate,
    LimpezaSuitesController.listar
);

router.post(
    '/limpeza/suites/:id/iniciar',
    authenticate,
    LimpezaSuitesController.iniciar
);

router.post(
    '/limpeza/suites/:id/concluir',
    authenticate,
    LimpezaSuitesController.concluir
);

module.exports = router;
