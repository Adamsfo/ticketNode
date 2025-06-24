"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const router = express_1.default.Router();
const { authenticate } = require('../middlewares/authMiddleware');
const CupomPromocionalController = require('../controllers/CupomPromocionalController');
router.get('/cupompromocional', CupomPromocionalController.get);
router.get('/cupompromocionalvalidade', CupomPromocionalController.getCupomPromocionalValidade);
router.post('/cupompromocional', authenticate, CupomPromocionalController.add);
router.post('/cupompromocionalvalidade', authenticate, CupomPromocionalController.addCupomPromocionalValidade);
router.put('/cupompromocional/:id', authenticate, CupomPromocionalController.edit);
router.put('/cupompromocionalvalidade/:id', authenticate, CupomPromocionalController.editCupomPromocionalValidade);
router.delete('/cupompromocional/:id', authenticate, CupomPromocionalController.delete);
router.delete('/cupompromocionalvalidade/:id', authenticate, CupomPromocionalController.deleteCupomPromocionalValidade);
module.exports = router;
