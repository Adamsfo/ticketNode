import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const ClienteFornecedorController = require('../controllers/ClienteFornecedorController')

router.get('/clientefornecedor', authenticate, ClienteFornecedorController.get)
router.post('/clientefornecedor', authenticate, ClienteFornecedorController.add)
router.put('/clientefornecedor/:id', authenticate, ClienteFornecedorController.edit)
router.delete('/clientefornecedor/:id', authenticate, ClienteFornecedorController.delete)

module.exports = router