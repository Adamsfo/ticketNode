import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const EventoSuiteController = require('../controllers/EventoSuiteController')
const EventoSuiteFotoController = require('../controllers/EventoSuiteFotoController')

router.get('/eventosuite', authenticate, EventoSuiteController.get)

router.get('/eventosuite/:id/fotos', authenticate, EventoSuiteFotoController.list)
router.post('/eventosuite/:id/fotos', authenticate, EventoSuiteFotoController.add)
router.post(
  '/eventosuite/:id/fotos/:fotoId/principal',
  authenticate,
  EventoSuiteFotoController.setPrincipal
)
router.post(
  '/eventosuite/:id/fotos/:fotoId/mover',
  authenticate,
  EventoSuiteFotoController.mover
)
router.delete(
  '/eventosuite/:id/fotos/:fotoId',
  authenticate,
  EventoSuiteFotoController.remove
)

router.get('/eventosuite/:id', authenticate, EventoSuiteController.getById)
router.post('/eventosuite', authenticate, EventoSuiteController.add)
router.put('/eventosuite/:id', authenticate, EventoSuiteController.edit)
router.delete('/eventosuite/:id', authenticate, EventoSuiteController.delete)

module.exports = router
