import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const PagamentoController = require('../controllers/PagamentoController')

router.get('/dadospagamento', PagamentoController.getPaymentData)
router.get('/cardscustomer', PagamentoController.getCardsCustomer)
router.get('/buscarparcelas', PagamentoController.buscarParcelas)
router.post('/pagamento', PagamentoController.pagamento)
router.post('/getpreference', PagamentoController.getPreferenceId)
router.post('/createCardToken', PagamentoController.createCardToken)

router.post('/create-customer', PagamentoController.createCustomer);
router.post('/save-card', PagamentoController.saveCard);
router.post('/process-payment', PagamentoController.processPayment);
// router.put('/evento/:id', authenticate, EventoController.edit)
// router.delete('/evento/:id', authenticate, EventoController.delete)

module.exports = router