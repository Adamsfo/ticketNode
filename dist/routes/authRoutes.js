"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const { login, addLogin, enviarEmailRecuperacaoSenha, varificaAtivarConta, enviaCodigoAtivacao } = require('../controllers/AuthController');
const router = express_1.default.Router();
router.post('/login', login);
router.post('/addlogin', addLogin);
router.post('/emailrecuperarsenha', enviarEmailRecuperacaoSenha);
router.post('/verificaativaconta', varificaAtivarConta);
router.post('/enviacodigoativacao', enviaCodigoAtivacao);
module.exports = router;
