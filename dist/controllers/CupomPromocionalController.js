"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const getRegistros_1 = require("../utils/getRegistros");
const customError_1 = require("../utils/customError");
const CupomPromocional_1 = require("../models/CupomPromocional");
module.exports = {
    async get(req, res, next) {
        await (0, getRegistros_1.getRegistros)(CupomPromocional_1.CupomPromocional, req, res, next);
    },
    async getCupomPromocionalValidade(req, res, next) {
        await (0, getRegistros_1.getRegistros)(CupomPromocional_1.CupomPromocionalValidade, req, res, next);
    },
    async add(req, res, next) {
        try {
            const { nome, idProdutor } = req.body;
            //   // Validação básica
            if (!nome || !idProdutor) {
                throw new customError_1.CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }
            const registro = await CupomPromocional_1.CupomPromocional.create(req.body);
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async addCupomPromocionalValidade(req, res, next) {
        try {
            const { idCupomPromocional, dataInicial, dataFinal } = req.body;
            if (!idCupomPromocional || !dataInicial || !dataFinal) {
                throw new customError_1.CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }
            // Ajustar horários
            const dataInicialDate = new Date(dataInicial);
            dataInicialDate.setHours(0, 0, 0, 0);
            const dataFinalDate = new Date(dataFinal);
            dataFinalDate.setHours(23, 59, 59, 999);
            const registro = await CupomPromocional_1.CupomPromocionalValidade.create({
                idCupomPromocional,
                dataInicial: dataInicialDate,
                dataFinal: dataFinalDate,
            });
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async edit(req, res, next) {
        try {
            const id = req.params.id;
            const registro = await CupomPromocional_1.CupomPromocional.findByPk(id);
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
            const registro = await CupomPromocional_1.CupomPromocional.findByPk(id);
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
    },
    async deleteCupomPromocionalValidade(req, res, next) {
        try {
            const id = req.params.id;
            if (!id) {
                throw new customError_1.CustomError('ID do registro é obrigatório.', 400, '');
            }
            // Verificar se o usuário existe
            const registro = await CupomPromocional_1.CupomPromocionalValidade.findByPk(id);
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
    },
    async editCupomPromocionalValidade(req, res, next) {
        try {
            const id = req.params.id;
            const registro = await CupomPromocional_1.CupomPromocionalValidade.findByPk(id);
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
};
