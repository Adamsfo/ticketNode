import express from 'express';

const router = express.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const HospedagemReceberSaldoController = require('../controllers/HospedagemReceberSaldoController');

/**
 * Rotas próprias do recebimento de saldo da hospedagem.
 * Isoladas do PagamentoPDV e da venda de ingressos.
 */
router.post(
    '/hospedagem/reservas/:id/receber-saldo',
    authenticate,
    HospedagemReceberSaldoController.receberSaldo
);

router.post(
    '/hospedagem-admin/reservas/:id/receber-saldo',
    authenticate,
    HospedagemReceberSaldoController.receberSaldo
);

module.exports = router;
