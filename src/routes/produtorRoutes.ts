import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const ProdutorController = require('../controllers/ProdutorController')

router.get('/produtor', ProdutorController.get)
router.get('/produtoracesso', ProdutorController.getAcessoProdutor)
router.post('/produtor', authenticate, ProdutorController.add)
router.post('/produtoracesso', authenticate, ProdutorController.addAcessoProdutor)
router.put('/produtor/:id', authenticate, ProdutorController.edit)
router.delete('/produtor/:id', authenticate, ProdutorController.delete)
router.delete('/produtoracesso/:id', authenticate, ProdutorController.deleteAcessoProdutor)

module.exports = router