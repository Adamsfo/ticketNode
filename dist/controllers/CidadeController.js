"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Cidade_1 = require("../models/Cidade");
const getRegistros_1 = require("../utils/getRegistros");
const customError_1 = require("../utils/customError");
module.exports = {
    async getCidade(req, res, next) {
        await (0, getRegistros_1.getRegistros)(Cidade_1.Cidade, req, res, next);
    },
    async addCidade(req, res, next) {
        try {
            const { descricao, uf } = req.body;
            // Validação básica
            if (!descricao || !uf) {
                throw new customError_1.CustomError('Os campos email, login, senha, nomeCompleto são obrigatórios.', 400, '');
            }
            const registro = await Cidade_1.Cidade.create({ descricao, uf });
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async editCidade(req, res, next) {
        try {
            const id = req.params.id;
            const { descricao, uf } = req.body;
            // Validação dos dados (exemplo simples)
            if (!id) {
                throw new customError_1.CustomError('ID da cidade é obrigatório.', 400, '');
            }
            if (!descricao && !uf) {
                // return res.status(400).json({ message: 'Nenhum campo para atualizar fornecido.' });
                throw new customError_1.CustomError('Nenhum campo para atualizar fornecido.', 400, '');
            }
            // Verificar se o usuário existe
            const registro = await Cidade_1.Cidade.findByPk(id);
            if (!registro) {
                throw new customError_1.CustomError('Usuário não encontrado.', 404, '');
                // return res.status(404).json({ message: 'Usuário não encontrado.' });
            }
            // Atualizar os campos permitidos
            if (descricao)
                registro.descricao = descricao;
            if (uf)
                registro.uf = uf;
            await registro.save();
            return res.status(200).json(registro);
        }
        catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },
    async deleteCidade(req, res, next) {
        try {
            const id = req.params.id;
            if (!id) {
                throw new customError_1.CustomError('ID é obrigatório.', 400, '');
                // return res.status(400).json({ message: 'ID do usuário é obrigatório.' });
            }
            // Verificar se o usuário existe
            const registro = await Cidade_1.Cidade.findByPk(id);
            if (!registro) {
                throw new customError_1.CustomError('Registro não encontrado.', 404, '');
                // return res.status(404).json({ message: 'Usuário não encontrado.' });
            }
            // Deletar o usuário
            await registro.destroy();
            return res.status(200).json({ message: 'Regsitro deletado com sucesso.' });
        }
        catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    }
};
