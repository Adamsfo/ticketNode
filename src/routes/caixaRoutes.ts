import express from 'express';

const router = express.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const { requireAdmGeral } = require('../middlewares/requireAdmGeral');
const CaixaController = require('../controllers/CaixaController');

router.get(
    '/admin/caixa',
    authenticate,
    requireAdmGeral,
    CaixaController.getResumo
);

module.exports = router;
