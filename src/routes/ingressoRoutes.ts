import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const IngressoController = require('../controllers/IngressoController')

router.get('/ingresso', IngressoController.get)
router.post('/ingresso', authenticate, IngressoController.add)
router.put('/ingresso/:id', authenticate, IngressoController.edit)
router.put('/ingressonome/:id', authenticate, IngressoController.editNomeImpresso)
router.put('/atribuiroutrousuario/:id', authenticate, IngressoController.atribuirOutroUsuario)
router.delete('/ingresso/:id', authenticate, IngressoController.delete)
router.post('/validadorjango', authenticate, IngressoController.validadorJango)
router.post('/validadorqrcode', authenticate, IngressoController.validadorQrCode)
router.get('/dadosingressos', authenticate, IngressoController.getDadosIngressos)

module.exports = router