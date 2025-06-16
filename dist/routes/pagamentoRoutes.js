"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const PagamentoController = require('../controllers/PagamentoController');
router.get('/dadospagamento', PagamentoController.getPaymentData);
router.get('/cardscustomer', PagamentoController.getCardsCustomer);
router.get('/buscarparcelas', PagamentoController.buscarParcelas);
router.get('/consultapagamento', PagamentoController.consultaPagamento);
router.post('/pagamento', PagamentoController.pagamento);
router.post('/pagamentocardsalvo', PagamentoController.pagamentoCardSalvo);
router.post('/pagamentopix', PagamentoController.pagamentoPix);
// router.post('/geracode', PagamentoController.geraTokenSplit)
// router.post('/getpreference', PagamentoController.getPreferenceId)
// router.post('/createCardToken', PagamentoController.createCardToken)
// router.post('/create-customer', PagamentoController.createCustomer);
// router.post('/save-card', PagamentoController.saveCard);
// router.post('/process-payment', PagamentoController.processPayment);
// router.put('/evento/:id', authenticate, EventoController.edit)
// router.delete('/evento/:id', authenticate, EventoController.delete)
module.exports = router;
