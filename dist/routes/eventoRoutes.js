"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const EventoController = require('../controllers/EventoController');
router.get('/evento', EventoController.get);
router.post('/evento', authenticate, EventoController.add);
router.put('/evento/:id', authenticate, EventoController.edit);
router.delete('/evento/:id', authenticate, EventoController.delete);
module.exports = router;
