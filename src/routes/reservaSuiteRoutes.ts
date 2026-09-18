import express from 'express';

const router = express.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const ReservaSuiteController = require('../controllers/ReservaSuiteController');

router.get('/reservasuite/disponibilidade', ReservaSuiteController.disponibilidade);
router.get('/reservasuite/cotacao', ReservaSuiteController.cotacao);
router.post('/reservasuite', authenticate, ReservaSuiteController.criar);
router.post('/reservasuite/checkout', authenticate, ReservaSuiteController.checkout);
router.get(
    '/reservasuite/resumo-pagamento',
    authenticate,
    ReservaSuiteController.resumoPagamento
);
router.get(
    '/reservasuite/reserva-confirmada',
    authenticate,
    ReservaSuiteController.reservaConfirmada
);
router.get(
    '/reservasuite/minhas-reservas',
    authenticate,
    ReservaSuiteController.minhasReservas
);
router.get(
    '/reservasuite/minhas-reservas/:id',
    authenticate,
    ReservaSuiteController.minhaReservaDetalhe
);
router.post(
    '/reservasuite/minhas-reservas/:id/cancelar',
    authenticate,
    ReservaSuiteController.cancelarMinhaReserva
);
router.post(
    '/reservasuite/minhas-reservas/:id/remarcar',
    authenticate,
    ReservaSuiteController.remarcarMinhaReserva
);
router.get(
    '/reservasuite/minhas-reservas/:id/remarcar/status',
    authenticate,
    ReservaSuiteController.statusRemarcacaoMinhaReserva
);
router.post(
    '/reservasuite/minhas-reservas/:id/remarcar/pix',
    authenticate,
    ReservaSuiteController.pagamentoPixRemarcacaoMinhaReserva
);
router.post(
    '/reservasuite/minhas-reservas/:id/remarcar/pagamento',
    authenticate,
    ReservaSuiteController.pagamentoCartaoRemarcacaoMinhaReserva
);
router.get(
    '/reservasuite/minhas-reservas/:id/remarcar/consulta',
    authenticate,
    ReservaSuiteController.consultaPagamentoRemarcacaoMinhaReserva
);
router.get(
    '/reservasuite/minhas-reservas/:id/remarcar/pix-pendente',
    authenticate,
    ReservaSuiteController.pixPendenteRemarcacaoMinhaReserva
);
router.post(
    '/reservasuite/remarcar/webhook-mercadopago',
    ReservaSuiteController.webhookMercadoPagoRemarcacao
);

// Público: consulta da reserva pelo token do link (sem auth)
router.get('/reserva/:token', ReservaSuiteController.reservaPublicaPorToken);
router.post(
    '/reserva/:token/autenticar',
    ReservaSuiteController.autenticarReservaPublicaPorToken
);
router.put(
    '/reserva/:token/hospedes',
    authenticate,
    ReservaSuiteController.salvarHospedesReservaPublicaPorToken
);

module.exports = router;
