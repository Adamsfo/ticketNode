import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const EventoSuiteController = require('../controllers/EventoSuiteController')

router.get('/eventosuite', EventoSuiteController.get)
router.post('/eventosuite', authenticate, EventoSuiteController.add)
router.put('/eventosuite/:id', authenticate, EventoSuiteController.edit)
router.delete('/eventosuite/:id', authenticate, EventoSuiteController.delete)

module.exports = router