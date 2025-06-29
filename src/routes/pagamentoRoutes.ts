import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const PagamentoController = require('../controllers/PagamentoController')

router.get('/dadospagamento', PagamentoController.getPaymentData)
router.get('/cardscustomer', PagamentoController.getCardsCustomer)
router.get('/buscarparcelas', PagamentoController.buscarParcelas)
router.get('/consultapagamento', PagamentoController.consultaPagamento)
router.post('/pagamento', PagamentoController.pagamento)
router.post('/pagamentoestorno', PagamentoController.estornoPagamento)
router.post('/pagamentocardsalvo', PagamentoController.pagamentoCardSalvo)
router.post('/pagamentopix', PagamentoController.pagamentoPix)
router.post('/getpreference', PagamentoController.createPreferencePayment)
router.post('/webhookmercadopago', PagamentoController.webHookMercadoPago)

// router.post('/geracode', PagamentoController.geraTokenSplit)
// router.post('/createCardToken', PagamentoController.createCardToken)
// router.post('/create-customer', PagamentoController.createCustomer);
// router.post('/save-card', PagamentoController.saveCard);
// router.post('/process-payment', PagamentoController.processPayment);
// router.put('/evento/:id', authenticate, EventoController.edit)
// router.delete('/evento/:id', authenticate, EventoController.delete)

module.exports = router