"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const EventoIngressoController = require('../controllers/EventoIngressoController');
router.get('/eventoingresso', EventoIngressoController.get);
router.post('/eventoingresso', authenticate, EventoIngressoController.add);
router.put('/eventoingresso/:id', authenticate, EventoIngressoController.edit);
router.delete('/eventoingresso/:id', authenticate, EventoIngressoController.delete);
module.exports = router;
