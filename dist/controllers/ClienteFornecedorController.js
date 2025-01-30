"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ClienteFornecedor_1 = require("../models/ClienteFornecedor");
const getRegistros_1 = require("../utils/getRegistros");
const customError_1 = require("../utils/customError");
module.exports = {
    async get(req, res, next) {
        await (0, getRegistros_1.getRegistros)(ClienteFornecedor_1.ClienteFornecedor, req, res, next);
    },
    async add(req, res, next) {
        try {
            const { empresaId, tipo, cnpjCpf, consumidorFinal, contribuinte } = req.body;
            //   // Validação básica
            if (!empresaId || !tipo || !cnpjCpf || !consumidorFinal || !contribuinte) {
                throw new customError_1.CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }
            const registro = await ClienteFornecedor_1.ClienteFornecedor.create(req.body);
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async edit(req, res, next) {
        try {
            const id = req.params.id;
            const registro = await ClienteFornecedor_1.ClienteFornecedor.findByPk(id);
            if (!registro) {
                throw new customError_1.CustomError('Registro não encontrado.', 404, '');
            }
            // Atualizar apenas os campos que estão definidos (não são undefined)
            Object.keys(req.body).forEach(field => {
                if (req.body[field] !== undefined && field in registro) {
                    registro[field] = req.body[field];
                }
            });
            await registro.save();
            return res.status(200).json(registro);
        }
        catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },
    async delete(req, res, next) {
        try {
            const id = req.params.id;
            if (!id) {
                throw new customError_1.CustomError('ID do registro é obrigatório.', 400, '');
            }
            // Verificar se o usuário existe
            const registro = await ClienteFornecedor_1.ClienteFornecedor.findByPk(id);
            if (!registro) {
                throw new customError_1.CustomError('Registro não encontrado.', 404, '');
                // return res.status(404).json({ message: 'Usuário não encontrado.' });
            }
            // Deletar o usuário
            await registro.destroy();
            return res.status(200).json({ message: 'Registro deletado com sucesso.' });
        }
        catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    }
};
