"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const ReservaSuiteController = require('../controllers/ReservaSuiteController');
router.get('/reservasuite/disponibilidade', ReservaSuiteController.disponibilidade);
router.get('/reservasuite/cotacao', ReservaSuiteController.cotacao);
router.post('/reservasuite', authenticate, ReservaSuiteController.criar);
router.post('/reservasuite/checkout', authenticate, ReservaSuiteController.checkout);
router.get('/reservasuite/resumo-pagamento', authenticate, ReservaSuiteController.resumoPagamento);
router.get('/reservasuite/reserva-confirmada', authenticate, ReservaSuiteController.reservaConfirmada);
module.exports = router;
