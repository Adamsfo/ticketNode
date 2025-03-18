import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const EventoIngressoController = require('../controllers/EventoIngressoController')

router.get('/eventoingresso', EventoIngressoController.get)
router.post('/eventoingresso', authenticate, EventoIngressoController.add)
router.put('/eventoingresso/:id', authenticate, EventoIngressoController.edit)
router.delete('/eventoingresso/:id', authenticate, EventoIngressoController.delete)

module.exports = router