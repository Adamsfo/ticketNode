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

module.exports = router;
