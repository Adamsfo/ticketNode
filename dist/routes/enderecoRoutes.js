"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const EnderecoController = require('../controllers/EnderecoController');
router.get('/endereco', authenticate, EnderecoController.get);
router.post('/endereco', authenticate, EnderecoController.add);
router.put('/endereco/:id', authenticate, EnderecoController.edit);
router.delete('/endereco/:id', authenticate, EnderecoController.delete);
module.exports = router;
