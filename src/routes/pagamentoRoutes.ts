import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const PagamentoController = require('../controllers/PagamentoController')

// router.get('/evento', EventoController.get)
router.post('/pagamento', PagamentoController.pagamento)
router.post('/getpreference', PagamentoController.getPreferenceId)
// router.put('/evento/:id', authenticate, EventoController.edit)
// router.delete('/evento/:id', authenticate, EventoController.delete)

module.exports = router