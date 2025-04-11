import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const IngressoController = require('../controllers/IngressoController')

router.get('/ingresso', authenticate, IngressoController.get)
router.post('/ingresso', authenticate, IngressoController.add)
router.put('/ingresso/:id', authenticate, IngressoController.edit)
router.delete('/ingresso/:id', authenticate, IngressoController.delete)

module.exports = router