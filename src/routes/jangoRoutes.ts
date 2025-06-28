import express from 'express'
const router = express.Router()
const { authenticate } = require('../middlewares/authMiddleware')
const JangoController = require('../controllers/JangoController')

router.post('/clientejango', JangoController.getCliente)
router.post('/clientejangoadd', JangoController.addCliente)

module.exports = router