import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const TicketController = require('../controllers/TicketController')

router.get('/ticket', authenticate, TicketController.get)
router.post('/ticket', authenticate, TicketController.add)
router.put('/ticketutilizado/:id', authenticate, TicketController.ticketUtilizado)
// router.delete('/empresa/:id', authenticate, EmpresaController.delete)

router.get('/tickethistorico', authenticate, TicketController.getHistorico)

module.exports = router