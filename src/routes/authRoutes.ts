import express from 'express';
const { login, addLogin, enviarEmailRecuperacaoSenha, varificaAtivarConta, enviaCodigoAtivacao, visitasNoSite } = require('../controllers/AuthController');

const router = express.Router();

router.post('/login', login);
router.post('/addlogin', addLogin);
router.post('/emailrecuperarsenha', enviarEmailRecuperacaoSenha);
router.post('/verificaativaconta', varificaAtivarConta);
router.post('/enviacodigoativacao', enviaCodigoAtivacao);
router.post('/visitasnosite', visitasNoSite);

module.exports = router;
