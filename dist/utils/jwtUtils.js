"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyToken = exports.generateToken = void 0;
const jwt = require('jsonwebtoken');
const secret = process.env.JWT_SECRET || 'secrectkey'; // Substitua por uma chave secreta segura
const generateToken = (user) => {
    return jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: '12h' });
};
exports.generateToken = generateToken;
const verifyToken = (token) => {
    return jwt.verify(token, secret);
};
exports.verifyToken = verifyToken;
// module.exports = { generateToken, verifyToken };
