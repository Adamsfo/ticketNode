"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Usuario_1 = require("../models/Usuario");
const jwtUtils_1 = require("../utils/jwtUtils");
const customError_1 = require("../utils/customError");
module.exports = {
    login: async (req, res, next) => {
        try {
            const { login, senha } = req.body;
            if (!login || !senha) {
                throw new customError_1.CustomError('Email e senha são obrigatórios.', 400, '');
            }
            const isEmail = login.includes('@');
            let usuario;
            if (isEmail) {
                usuario = await Usuario_1.Usuario.findOne({ where: { email: login } });
            }
            else {
                usuario = await Usuario_1.Usuario.findOne({ where: { login } });
            }
            if (!usuario || !(await usuario.verifyPassword(senha))) {
                throw new customError_1.CustomError('Credenciais inválidas.', 401, '');
            }
            const token = (0, jwtUtils_1.generateToken)(usuario);
            usuario.token = token;
            usuario.save();
            res.status(200).json({
                data: token
            });
            // return res.status(200).json({ token });
        }
        catch (error) {
            next(error);
        }
    },
    addLogin: async (req, res, next) => {
        try {
            const { login, email, senha, nomeCompleto } = req.body;
            if (!login || !senha || !email) {
                throw new customError_1.CustomError('Login, email e senha são obrigatórios.', 400, '');
            }
            let registro = await Usuario_1.Usuario.findOne({ where: { email } });
            if (registro) {
                throw new customError_1.CustomError('Este email já foi cadastrado, utilize recuperar senha.', 400, '');
            }
            registro = await Usuario_1.Usuario.findOne({ where: { login } });
            if (registro) {
                throw new customError_1.CustomError('Este login já foi utilizado por outro usuário .', 400, '');
            }
            let ativo = false;
            registro = await Usuario_1.Usuario.create({ login, email, senha, nomeCompleto, ativo });
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
};
