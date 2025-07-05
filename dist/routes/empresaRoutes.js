"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const EmpresaController = require('../controllers/EmpresaController');
router.get('/empresa', EmpresaController.get);
router.post('/empresa', authenticate, EmpresaController.add);
router.put('/empresa/:id', authenticate, EmpresaController.edit);
router.delete('/empresa/:id', authenticate, EmpresaController.delete);
module.exports = router;
