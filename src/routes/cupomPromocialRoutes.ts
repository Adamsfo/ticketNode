import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const CupomPromocionalController = require('../controllers/CupomPromocionalController')

router.get('/cupompromocional', CupomPromocionalController.get)
router.get('/cupompromocionalvalidade', CupomPromocionalController.getCupomPromocionalValidade)
router.post('/cupompromocional', authenticate, CupomPromocionalController.add)
router.post('/cupompromocionalvalidade', authenticate, CupomPromocionalController.addCupomPromocionalValidade)
router.put('/cupompromocional/:id', authenticate, CupomPromocionalController.edit)
router.delete('/cupompromocional/:id', authenticate, CupomPromocionalController.delete)
router.delete('/cupompromocionalvalidade/:id', authenticate, CupomPromocionalController.deleteCupomPromocionalValidade)

module.exports = router