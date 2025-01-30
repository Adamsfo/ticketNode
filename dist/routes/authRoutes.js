"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const { login, addLogin } = require('../controllers/AuthController');
const router = express_1.default.Router();
router.post('/login', login);
router.post('/addlogin', addLogin);
module.exports = router;
