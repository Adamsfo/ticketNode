import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const EventoController = require('../controllers/EventoController')

router.get('/evento', authenticate, EventoController.get)
router.post('/evento', authenticate, EventoController.add)
router.put('/evento/:id', authenticate, EventoController.edit)
router.delete('/evento/:id', authenticate, EventoController.delete)

module.exports = router