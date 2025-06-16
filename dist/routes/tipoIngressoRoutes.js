"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const TipoIngressoController = require('../controllers/TipoIngressoController');
router.get('/tipoingresso', authenticate, TipoIngressoController.get);
router.post('/tipoingresso', authenticate, TipoIngressoController.add);
router.put('/tipoingresso/:id', authenticate, TipoIngressoController.edit);
router.delete('/tipoingresso/:id', authenticate, TipoIngressoController.delete);
module.exports = router;
