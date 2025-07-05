import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const EmpresaController = require('../controllers/EmpresaController')

router.get('/empresa', EmpresaController.get)
router.post('/empresa', authenticate, EmpresaController.add)
router.put('/empresa/:id', authenticate, EmpresaController.edit)
router.delete('/empresa/:id', authenticate, EmpresaController.delete)

module.exports = router