import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const TipoIngressoController = require('../controllers/TipoIngressoController')

router.get('/tipoingresso', authenticate, TipoIngressoController.get)
router.post('/tipoingresso', authenticate, TipoIngressoController.add)
router.put('/tipoingresso/:id', authenticate, TipoIngressoController.edit)
router.delete('/tipoingresso/:id', authenticate, TipoIngressoController.delete)

module.exports = router