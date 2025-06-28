"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const JangoController = require('../controllers/JangoController');
router.post('/clientejango', JangoController.getCliente);
router.post('/clientejangoadd', JangoController.addCliente);
module.exports = router;
