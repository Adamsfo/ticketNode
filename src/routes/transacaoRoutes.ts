import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const TransacaoController = require('../controllers/TransacaoController')

router.get('/transacao', authenticate, TransacaoController.get)
router.post('/transacao', authenticate, TransacaoController.add)
router.put('/transacao/:id', authenticate, TransacaoController.edit)
router.delete('/transacao/:id', authenticate, TransacaoController.delete)
router.get('/ingressotransacao', authenticate, TransacaoController.getIngressoTransacao)
router.post('/ingressotransacaocupomdesconto', authenticate, TransacaoController.getTransacaoCupomDesconto)

module.exports = router