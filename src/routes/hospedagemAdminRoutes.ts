import express from 'express';

const router = express.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const HospedagemAdminController = require('../controllers/HospedagemAdminController');

// Endpoints oficiais
router.get(
    '/hospedagem/reservas',
    authenticate,
    HospedagemAdminController.listarReservas
);
router.get(
    '/hospedagem/reservas/:id',
    authenticate,
    HospedagemAdminController.detalheReserva
);
router.post(
    '/hospedagem/reservas/:id/checkin',
    authenticate,
    HospedagemAdminController.realizarCheckin
);
router.post(
    '/hospedagem/reservas/:id/checkout',
    authenticate,
    HospedagemAdminController.realizarCheckout
);
router.post(
    '/hospedagem/reservas/recepcao',
    authenticate,
    HospedagemAdminController.criarReservaRecepcao
);

// Alias legado (mesma lógica)
router.get(
    '/hospedagem-admin/reservas',
    authenticate,
    HospedagemAdminController.listarReservas
);
router.get(
    '/hospedagem-admin/reservas/:id',
    authenticate,
    HospedagemAdminController.detalheReserva
);
router.post(
    '/hospedagem-admin/reservas/:id/checkin',
    authenticate,
    HospedagemAdminController.realizarCheckin
);
router.post(
    '/hospedagem-admin/reservas/:id/checkout',
    authenticate,
    HospedagemAdminController.realizarCheckout
);
router.post(
    '/hospedagem-admin/reservas/recepcao',
    authenticate,
    HospedagemAdminController.criarReservaRecepcao
);
router.get(
    '/hospedagem-admin/suites',
    authenticate,
    HospedagemAdminController.listarSuites
);
router.get(
    '/hospedagem-admin/suites/:id',
    authenticate,
    HospedagemAdminController.detalheSuite
);
router.get(
    '/hospedagem/suites',
    authenticate,
    HospedagemAdminController.listarSuites
);
router.get(
    '/hospedagem/suites/:id',
    authenticate,
    HospedagemAdminController.detalheSuite
);

module.exports = router;
