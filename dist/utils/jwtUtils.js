"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLoginToken = exports.verifyToken = exports.generateToken = void 0;
const jwt = require("jsonwebtoken");
const secret = process.env.JWT_SECRET;
const generateToken = (user) => {
    return jwt.sign({ id: user.id, email: user.email }, secret, {
        expiresIn: "48h",
    });
};
exports.generateToken = generateToken;
const verifyToken = (token) => {
    return jwt.verify(token, secret);
};
exports.verifyToken = verifyToken;
const resolveLoginToken = (usuario, manterOutrasConexoes) => {
    if (manterOutrasConexoes && usuario.token) {
        try {
            (0, exports.verifyToken)(usuario.token);
            return { token: usuario.token, persist: false };
        }
        catch {
            // token ausente, inválido ou expirado — gera novo abaixo
        }
    }
    const token = (0, exports.generateToken)(usuario);
    return { token, persist: true };
};
exports.resolveLoginToken = resolveLoginToken;
