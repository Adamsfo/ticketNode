"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const apiJango_1 = __importDefault(require("../api/apiJango"));
const customError_1 = require("../utils/customError");
module.exports = {
    async getCliente(req, res, next) {
        try {
            const cpf = req.body.cpf;
            console.log(req.query);
            if (!cpf) {
                throw new customError_1.CustomError('CPF é obrigatório.', 400, '');
            }
            const dadosJango = await (0, apiJango_1.default)().getCliente(cpf);
            if (!dadosJango[0]) {
                throw new customError_1.CustomError('Cliente não encontrado.', 404, '');
            }
            // const registro = {
            //     id: dadosJango[0].ID,
            //     cpf: dadosJango[0].CPF_CNPJ,
            //     nomeCompleto: dadosJango[0].NOME,
            //     telefone: dadosJango[0].TELEFONE_CELULAR,
            //     email: dadosJango[0].EMAIL,
            // };
            console.log("Registro retornado:", dadosJango[0]);
            return res.status(200).json(dadosJango[0]);
        }
        catch (error) {
            next(error);
        }
    },
    async addCliente(req, res, next) {
        try {
            const { cpf, nomeCompleto, sobreNome, telefone, email } = req.body;
            // Validação básica
            if (!cpf || !nomeCompleto || !sobreNome || !telefone || !email) {
                throw new customError_1.CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }
            await (0, apiJango_1.default)().atualizarCliente({
                CPF_CNPJ: (cpf ?? "").replace(/\D/g, ""),
                NOME: nomeCompleto + " " + sobreNome,
                TELEFONE_CELULAR: (telefone ?? "").replace(/\D/g, ""),
                EMAIL: email,
            });
            await new Promise((resolve) => setTimeout(resolve, 1000));
            const dadosJango = await (0, apiJango_1.default)().getCliente(cpf);
            if (!dadosJango[0]) {
                throw new customError_1.CustomError('Cliente não encontrado após atualização.', 404, '');
            }
            return res.status(201).json(dadosJango[0]);
        }
        catch (error) {
            next(error);
        }
    },
};
