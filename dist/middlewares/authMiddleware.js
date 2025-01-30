"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jwtUtils_1 = require("../utils/jwtUtils");
const customError_1 = require("../utils/customError");
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Suporta "Bearer <token>"
    if (!token) {
        throw new customError_1.CustomError('Token de autenticação não fornecido.', 401, '');
    }
    try {
        const decoded = (0, jwtUtils_1.verifyToken)(token);
        req.user = decoded; // Adiciona usuário decodificado ao req
        next();
    }
    catch (error) {
        throw new customError_1.CustomError('Token de autenticação inválido.', 403, '');
    }
};
module.exports = { authenticate };
