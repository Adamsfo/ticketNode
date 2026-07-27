import express from 'express';

const router = express.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const HospedagemPagamentoController = require('../controllers/HospedagemPagamentoController');

/**
 * Rotas próprias de pagamento da hospedagem (SuperTEF + dinheiro/manual).
 * Isoladas de /pagamentopos, /pagamentodinheiro e demais rotas do PDV.
 */
const base = '/hospedagem/reservas/:id/pagamento';
const baseAlias = '/hospedagem-admin/reservas/:id/pagamento';

function mount(prefix: string) {
    router.post(
        `${prefix}/dinheiro`,
        authenticate,
        HospedagemPagamentoController.receberDinheiro
    );
    router.post(
        `${prefix}/manual`,
        authenticate,
        HospedagemPagamentoController.receberManual
    );
    router.post(
        `${prefix}/tef/iniciar`,
        authenticate,
        HospedagemPagamentoController.iniciarTef
    );
    router.get(
        `${prefix}/tef/consultar`,
        authenticate,
        HospedagemPagamentoController.consultarTef
    );
    router.post(
        `${prefix}/tef/cancelar`,
        authenticate,
        HospedagemPagamentoController.cancelarTef
    );
    router.post(
        `${prefix}/tef/finalizar`,
        authenticate,
        HospedagemPagamentoController.finalizarTef
    );
}

mount(base);
mount(baseAlias);

module.exports = router;
