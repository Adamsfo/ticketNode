"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const ProdutorController = require('../controllers/ProdutorController');
router.get('/produtor', ProdutorController.get);
router.get('/produtoracesso', ProdutorController.getAcessoProdutor);
router.post('/produtor', authenticate, ProdutorController.add);
router.post('/produtoracesso', authenticate, ProdutorController.addAcessoProdutor);
router.put('/produtor/:id', authenticate, ProdutorController.edit);
router.delete('/produtor/:id', authenticate, ProdutorController.delete);
router.delete('/produtoracesso/:id', authenticate, ProdutorController.deleteAcessoProdutor);
module.exports = router;
