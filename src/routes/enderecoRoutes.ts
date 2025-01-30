import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const EnderecoController = require('../controllers/EnderecoController')

router.get('/endereco', authenticate, EnderecoController.get)
router.post('/endereco', authenticate, EnderecoController.add)
router.put('/endereco/:id', authenticate, EnderecoController.edit)
router.delete('/endereco/:id', authenticate, EnderecoController.delete)

module.exports = router