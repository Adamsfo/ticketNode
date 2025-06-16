"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const IngressoController = require('../controllers/IngressoController');
router.get('/ingresso', IngressoController.get);
router.post('/ingresso', authenticate, IngressoController.add);
router.put('/ingresso/:id', authenticate, IngressoController.edit);
router.put('/ingressonome/:id', authenticate, IngressoController.editNomeImpresso);
router.put('/atribuiroutrousuario/:id', authenticate, IngressoController.atribuirOutroUsuario);
router.delete('/ingresso/:id', authenticate, IngressoController.delete);
router.post('/validadorjango', authenticate, IngressoController.validadorJango);
module.exports = router;
