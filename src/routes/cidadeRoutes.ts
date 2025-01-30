import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const CidadeController = require('../controllers/CidadeController')

router.get('/cidade', authenticate, CidadeController.getCidade)
router.put('/cidade/:id', authenticate, CidadeController.editCidade)
router.post('/cidade', authenticate, CidadeController.addCidade)
router.delete('/cidade/:id', authenticate, CidadeController.deleteCidade)

module.exports = router