"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const TransacaoController = require('../controllers/TransacaoController');
router.get('/transacao', authenticate, TransacaoController.get);
router.post('/transacao', authenticate, TransacaoController.add);
router.put('/transacao/:id', authenticate, TransacaoController.edit);
router.delete('/transacao/:id', authenticate, TransacaoController.delete);
router.get('/ingressotransacao', authenticate, TransacaoController.getIngressoTransacao);
module.exports = router;
