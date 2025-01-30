"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const ClienteFornecedorController = require('../controllers/ClienteFornecedorController');
router.get('/clientefornecedor', authenticate, ClienteFornecedorController.get);
router.post('/clientefornecedor', authenticate, ClienteFornecedorController.add);
router.put('/clientefornecedor/:id', authenticate, ClienteFornecedorController.edit);
router.delete('/clientefornecedor/:id', authenticate, ClienteFornecedorController.delete);
module.exports = router;
