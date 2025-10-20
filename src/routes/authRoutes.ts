import express from 'express';
const { login, addLogin, enviarEmailRecuperacaoSenha, varificaAtivarConta, enviaCodigoAtivacao, visitasNoSite, loginEmailCodigo, geraCodigoLogin } = require('../controllers/AuthController');

const router = express.Router();

router.post('/login', login);
router.post('/addlogin', addLogin);
router.post('/emailrecuperarsenha', enviarEmailRecuperacaoSenha);
router.post('/verificaativaconta', varificaAtivarConta);
router.post('/enviacodigoativacao', enviaCodigoAtivacao);
router.post('/geracodigologin', geraCodigoLogin);
router.post('/visitasnosite', visitasNoSite);
router.post('/loginemailcodigo', loginEmailCodigo)

module.exports = router;
