"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const getRegistros_1 = require("../utils/getRegistros");
const customError_1 = require("../utils/customError");
const EventoIngresso_1 = require("../models/EventoIngresso");
const TipoIngresso_1 = require("../models/TipoIngresso");
const CupomPromocional_1 = require("../models/CupomPromocional");
const Ingresso_1 = require("../models/Ingresso");
const sequelize_1 = require("sequelize");
module.exports = {
    async get(req, res, next) {
        try {
            // Busca os registros padrão
            const result = await (0, getRegistros_1.getRegistros)(EventoIngresso_1.EventoIngresso, req, res, next, [
                {
                    model: TipoIngresso_1.TipoIngresso,
                    as: 'TipoIngresso',
                    attributes: ['descricao'],
                },
                {
                    model: CupomPromocional_1.CupomPromocional,
                    as: 'CupomPromocional',
                    attributes: ['nome'],
                },
            ], true);
            const { data, meta } = result ?? {
                data: [],
                meta: { totalItems: 0, totalPages: 0, currentPage: 0, pageSize: 0 },
            };
            // Busca apenas a contagem de ingressos confirmados por EventoIngresso
            const contagens = await Ingresso_1.Ingresso.findAll({
                attributes: [
                    'idEventoIngresso',
                    [(0, sequelize_1.fn)('COUNT', (0, sequelize_1.col)('id')), 'totalConfirmados'],
                ],
                where: { status: 'Confirmado' },
                group: ['idEventoIngresso'],
                raw: true,
            });
            // Cria um mapa para acesso rápido
            const mapaContagens = {};
            contagens.forEach((item) => {
                mapaContagens[item.idEventoIngresso] = Number(item.totalConfirmados);
            });
            // Adiciona o campo `ingressosConfirmados` aos registros
            const dataComContagem = data.map((registro) => ({
                ...registro,
                ingressosConfirmados: mapaContagens[registro.id] ?? 0,
            }));
            // Retorna o resultado final
            res.status(200).json({
                data: dataComContagem,
                meta,
            });
        }
        catch (err) {
            next(err);
        }
    },
    async add(req, res, next) {
        try {
            const { nome, idTipoIngresso, idEvento, qtde, preco, taxaServico, lote, valor } = req.body;
            //   // Validação básica
            if (!nome || !idTipoIngresso || !idEvento || !qtde || !preco || !taxaServico || !lote || !valor) {
                throw new customError_1.CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }
            const registro = await EventoIngresso_1.EventoIngresso.create(req.body);
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async edit(req, res, next) {
        try {
            const id = req.params.id;
            const registro = await EventoIngresso_1.EventoIngresso.findByPk(id);
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
            const registro = await EventoIngresso_1.EventoIngresso.findByPk(id);
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
