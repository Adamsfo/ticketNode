"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addHistorico = void 0;
const getRegistros_1 = require("../utils/getRegistros");
const customError_1 = require("../utils/customError");
const Transacao_1 = require("../models/Transacao");
const Ingresso_1 = require("../models/Ingresso");
const EventoIngresso_1 = require("../models/EventoIngresso");
const Evento_1 = require("../models/Evento");
const addHistorico = async (idTransacao, idUsuario, descricao) => {
    try {
        const data = new Date(); // Data atual
        await Transacao_1.HistoricoTransacao.create({ idTransacao, idUsuario, data, descricao });
        return true; // Retorna true se a operação for bem-sucedida
    }
    catch (error) {
        console.error('Erro ao adicionar histórico:', error);
        return false; // Retorna false se ocorrer um erro
    }
};
exports.addHistorico = addHistorico;
module.exports = {
    async get(req, res, next) {
        await (0, getRegistros_1.getRegistros)(Transacao_1.Transacao, req, res, next);
    },
    async getIngressoTransacao(req, res, next) {
        await (0, getRegistros_1.getRegistros)(Transacao_1.IngressoTransacao, req, res, next, [
            {
                model: Ingresso_1.Ingresso,
                as: 'Ingresso',
                include: [
                    {
                        model: EventoIngresso_1.EventoIngresso,
                        as: 'EventoIngresso',
                        // attributes: ['idEventoIngresso', 'nomeEvento', 'dataEvento']
                    },
                    {
                        model: Evento_1.Evento,
                        as: 'Evento',
                        // attributes: ['idEventoIngresso', 'nomeEvento', 'dataEvento']
                    }
                ],
            }
        ]);
    },
    async add(req, res, next) {
        try {
            console.log('addTransacao', req.body);
            const { idUsuario, preco, taxaServico, valorTotal } = req.body;
            const dataTransacao = new Date(); // Data atual
            const status = 'Aguardando pagamento'; // Definindo o status como "Reservado" por padrão
            //   // Validação básica
            if (!preco || !taxaServico || !valorTotal || !idUsuario) {
                throw new customError_1.CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }
            const registro = await Transacao_1.Transacao.create({ ...req.body, status, dataTransacao });
            // Adiciona o histórico após a criação do ingresso
            await (0, exports.addHistorico)(registro.id, idUsuario, 'Transação criada com sucesso.');
            //itens da transação
            //Primeiro criar a transação 
            //depois criar os ingressos e enviar o idTransacao para cada ingresso e criar o item da transação
            // caso nao criar todos os ingressos cancelar a transacao
            // atualizar a transacao depois de criado todos os ingressos
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async edit(req, res, next) {
        try {
            const id = req.params.id;
            const registro = await Transacao_1.Transacao.findByPk(id);
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
            const registro = await Transacao_1.Transacao.findByPk(id);
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
