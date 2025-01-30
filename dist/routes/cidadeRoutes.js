"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const CidadeController = require('../controllers/CidadeController');
router.get('/cidade', authenticate, CidadeController.getCidade);
router.put('/cidade/:id', authenticate, CidadeController.editCidade);
router.post('/cidade', authenticate, CidadeController.addCidade);
router.delete('/cidade/:id', authenticate, CidadeController.deleteCidade);
module.exports = router;
