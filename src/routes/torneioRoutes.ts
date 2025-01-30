import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const TorneioController = require('../controllers/TorneioController')
const TorneioItemController = require('../controllers/TorneioItemController')
const TorneioBlindItemController = require('../controllers/TorneioBlindItemController')
// const BlindItemController = require('../controllers/BlindItemController')

router.get('/torneio', authenticate, TorneioController.get)
router.post('/torneio', authenticate, TorneioController.add)
router.put('/torneio/:id', authenticate, TorneioController.edit)
router.delete('/torneio/:id', authenticate, TorneioController.delete)

router.get('/torneioitem', authenticate, TorneioItemController.get)
router.post('/torneioitem', authenticate, TorneioItemController.add)
router.put('/torneioitem/:id', authenticate, TorneioItemController.edit)
router.delete('/torneioitem/:id', authenticate, TorneioItemController.delete)

router.get('/torneioblinditem', authenticate, TorneioBlindItemController.get)
router.post('/torneioblinditem', authenticate, TorneioBlindItemController.add)
router.put('/torneioblinditem/:id', authenticate, TorneioBlindItemController.edit)
router.delete('/torneioblinditem/:id', authenticate, TorneioBlindItemController.delete)

router.post('/torneio/iniciar', authenticate, TorneioController.iniciar)
router.post('/torneio/parar', authenticate, TorneioController.parar)
router.get('/torneio/status', authenticate, TorneioController.status)

module.exports = router