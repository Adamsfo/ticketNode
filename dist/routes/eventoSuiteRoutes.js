"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const EventoSuiteController = require('../controllers/EventoSuiteController');
router.get('/eventosuite', EventoSuiteController.get);
router.post('/eventosuite', authenticate, EventoSuiteController.add);
router.put('/eventosuite/:id', authenticate, EventoSuiteController.edit);
router.delete('/eventosuite/:id', authenticate, EventoSuiteController.delete);
module.exports = router;
