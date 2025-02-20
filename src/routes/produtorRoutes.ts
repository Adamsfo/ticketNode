import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const ProdutorController = require('../controllers/ProdutorController')

router.get('/produtor', authenticate, ProdutorController.get)
router.post('/produtor', authenticate, ProdutorController.add)
router.put('/produtor/:id', authenticate, ProdutorController.edit)
router.delete('/produtor/:id', authenticate, ProdutorController.delete)

module.exports = router