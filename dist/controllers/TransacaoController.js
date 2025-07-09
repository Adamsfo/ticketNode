"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addHistorico = void 0;
const getRegistros_1 = require("../utils/getRegistros");
const customError_1 = require("../utils/customError");
const Transacao_1 = require("../models/Transacao");
const Ingresso_1 = require("../models/Ingresso");
const EventoIngresso_1 = require("../models/EventoIngresso");
const Evento_1 = require("../models/Evento");
const CupomPromocional_1 = require("../models/CupomPromocional");
const sequelize_1 = require("sequelize");
const TipoIngresso_1 = require("../models/TipoIngresso");
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
                        include: [
                            {
                                model: TipoIngresso_1.TipoIngresso,
                                as: 'TipoIngresso',
                                attributes: ['descricao'], // 🔥 Aqui você retorna só a descrição
                            }
                        ]
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
            const registro = await Transacao_1.Transacao.create({ ...req.body, status, dataTransacao, aceiteCompra: true });
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
    },
    getTransacaoCupomDesconto1: async (req, res, next) => {
        try {
            const { idTransacao, nomeCupomDesconto } = req.body;
            if (!idTransacao || !nomeCupomDesconto) {
                throw new customError_1.CustomError('ID da transação e Nome Cupom são obrigatório.', 400, '');
            }
            // Verifica se a transação existe            
            const transacao = await Transacao_1.Transacao.findByPk(idTransacao);
            if (!transacao) {
                throw new customError_1.CustomError('Transação não encontrada.', 404, '');
            }
            // Verifica se o cupom de desconto existe
            const cupomDesconto = await CupomPromocional_1.CupomPromocional.findOne({
                where: {
                    nome: nomeCupomDesconto,
                }
            });
            if (!cupomDesconto) {
                throw new customError_1.CustomError('Cupom promocional não encontrado.', 404, '');
            }
            const ingressosTransacao = await Transacao_1.IngressoTransacao.findAll({
                where: {
                    idTransacao: idTransacao,
                },
            });
            if (!ingressosTransacao || ingressosTransacao.length === 0) {
                throw new customError_1.CustomError('Nenhum ingresso encontrado para esta transação.', 404, '');
            }
            for (const ingressoTransacao of ingressosTransacao) {
                const ingresso = await Ingresso_1.Ingresso.findByPk(ingressoTransacao.idIngresso);
                if (!ingresso) {
                    throw new customError_1.CustomError(`Ingresso com ID ${ingressoTransacao.idIngresso} não encontrado.`, 404, '');
                }
                const eventoIngresso = await EventoIngresso_1.EventoIngresso.findOne({
                    where: {
                        id: ingresso.idEventoIngresso,
                        idCupomPromocional: cupomDesconto.id,
                    }
                });
                if (eventoIngresso) {
                    console.log('Evento Ingresso encontrado:', eventoIngresso);
                    const cupomPromocialValidade = await CupomPromocional_1.CupomPromocionalValidade.findOne({
                        where: {
                            idCupomPromocional: eventoIngresso.idCupomPromocional, // ou o ID que você quer comparar
                            dataInicial: { [sequelize_1.Op.lte]: new Date() },
                            dataFinal: { [sequelize_1.Op.gte]: new Date() },
                        },
                    });
                    // if (cupomPromocialValidade) {
                    //     // Aplicar o desconto
                    //     if (ingressoTransacao.precoOriginal === null || ingressoTransacao.precoOriginal === undefined) {
                    //         ingressoTransacao.precoOriginal = ingressoTransacao.preco;
                    //     }
                    //     ingressoTransacao.idCupomPromocionalValidade = cupomPromocialValidade.id;
                    //     ingressoTransacao.tipoDesconto = cupomDesconto.tipoDesconto;
                    //     ingressoTransacao.valorDesconto = cupomDesconto.valorDesconto;
                    //     if (cupomDesconto.tipoDesconto === 'Percentual') {
                    //         ingressoTransacao.precoDesconto = ingressoTransacao.precoOriginal * (cupomDesconto.valorDesconto / 100);
                    //         ingressoTransacao.valorTotal = ingressoTransacao.precoOriginal - ingressoTransacao.precoDesconto + ingressoTransacao.taxaServico;
                    //     } else if (cupomDesconto.tipoDesconto === 'Fixo') {
                    //         ingressoTransacao.precoDesconto = cupomDesconto.valorDesconto;
                    //         ingressoTransacao.valorTotal = ingressoTransacao.precoOriginal - ingressoTransacao.precoDesconto + ingressoTransacao.taxaServico;
                    //     }
                    //     // Atualizar o ingresso transação com o novo valor total
                    //     await ingressoTransacao.save();
                    // } else {
                    //     // throw new CustomError('Cupom promocional não está válido para este ingresso.', 400, '');
                    // }
                }
            }
            return res.status(200).json("Cupom promocional aplicado com sucesso.");
        }
        catch (error) {
            console.error('Erro ao aplicar cupom promocional:', error);
            if (error instanceof customError_1.CustomError) {
                return res.status(error.statusCode).json({ message: error.message });
            }
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },
    getTransacaoCupomDesconto: async (req, res, next) => {
        try {
            const { idTransacao, nomeCupomDesconto } = req.body;
            if (!idTransacao || !nomeCupomDesconto) {
                throw new customError_1.CustomError('ID da transação e Nome Cupom são obrigatórios.', 400, '');
            }
            const transacao = await Transacao_1.Transacao.findByPk(idTransacao);
            if (!transacao) {
                throw new customError_1.CustomError('Transação não encontrada.', 404, '');
            }
            const cupomDesconto = await CupomPromocional_1.CupomPromocional.findOne({
                where: { nome: nomeCupomDesconto }
            });
            if (!cupomDesconto) {
                throw new customError_1.CustomError('Cupom promocional não encontrado.', 404, '');
            }
            const validadeCupom = await CupomPromocional_1.CupomPromocionalValidade.findOne({
                where: {
                    idCupomPromocional: cupomDesconto.id,
                    dataInicial: { [sequelize_1.Op.lte]: new Date() },
                    dataFinal: { [sequelize_1.Op.gte]: new Date() },
                }
            });
            if (!validadeCupom) {
                throw new customError_1.CustomError('Cupom fora da validade.', 400, '');
            }
            const ingressosTransacao = await Transacao_1.IngressoTransacao.findAll({
                where: { idTransacao }
            });
            if (!ingressosTransacao.length) {
                throw new customError_1.CustomError('Nenhum ingresso encontrado para esta transação.', 404, '');
            }
            await Promise.all(ingressosTransacao.map(async (ingressoTransacao) => {
                const ingresso = await Ingresso_1.Ingresso.findByPk(ingressoTransacao.idIngresso);
                if (!ingresso) {
                    throw new customError_1.CustomError(`Ingresso ID ${ingressoTransacao.idIngresso} não encontrado.`, 404, '');
                }
                const eventoIngresso = await EventoIngresso_1.EventoIngresso.findOne({
                    where: {
                        id: ingresso.idEventoIngresso,
                        idCupomPromocional: cupomDesconto.id,
                    }
                });
                if (eventoIngresso) {
                    try {
                        if (ingressoTransacao.precoOriginal === null) {
                            ingressoTransacao.precoOriginal = ingressoTransacao.preco;
                        }
                        if (ingressoTransacao.taxaServicoOriginal === null) {
                            ingressoTransacao.taxaServicoOriginal = ingressoTransacao.taxaServico;
                        }
                        if (!ingressoTransacao.precoOriginal) {
                            throw new customError_1.CustomError('Preço original do ingresso não definido.', 400, '');
                        }
                        ingressoTransacao.idCupomPromocionalValidade = validadeCupom.id;
                        ingressoTransacao.tipoDesconto = cupomDesconto.tipoDesconto;
                        ingressoTransacao.valorDesconto = cupomDesconto.valorDesconto;
                        ingressoTransacao.precoDesconto = Number(0);
                        if (cupomDesconto.tipoDesconto === 'Percentual') {
                            ingressoTransacao.precoDesconto = Number((ingressoTransacao.precoOriginal * cupomDesconto.valorDesconto) / 100);
                        }
                        else if (cupomDesconto.tipoDesconto === 'Fixo') {
                            ingressoTransacao.precoDesconto = Number(cupomDesconto.valorDesconto);
                        }
                        if (cupomDesconto.valorDescontoTaxa) {
                            ingressoTransacao.taxaServico = Number(ingressoTransacao.taxaServicoOriginal) - Number(cupomDesconto.valorDescontoTaxa);
                            ingressoTransacao.taxaServicoDesconto = Number(cupomDesconto.valorDescontoTaxa);
                        }
                        ingressoTransacao.preco = Number(ingressoTransacao.precoOriginal) - Number(ingressoTransacao.precoDesconto);
                        ingressoTransacao.valorTotal = Number(ingressoTransacao.preco) + Number(ingressoTransacao.taxaServico);
                        await ingressoTransacao.save();
                    }
                    catch (error) {
                        console.error('Erro ao calcular desconto:', error);
                        throw new customError_1.CustomError('Erro ao calcular desconto do ingresso.', 500, '');
                    }
                }
                else {
                    // 🚩 REVERTER PARA VALORES ORIGINAIS
                    try {
                        if (ingressoTransacao.precoOriginal !== null && ingressoTransacao.precoOriginal !== undefined) {
                            ingressoTransacao.preco = Number(ingressoTransacao.precoOriginal);
                            ingressoTransacao.valorTotal = Number(ingressoTransacao.preco) + Number(ingressoTransacao.taxaServico);
                        }
                        if (ingressoTransacao.taxaServicoOriginal === null) {
                            ingressoTransacao.taxaServicoOriginal = Number(ingressoTransacao.taxaServico);
                        }
                        ingressoTransacao.idCupomPromocionalValidade = null;
                        ingressoTransacao.tipoDesconto = CupomPromocional_1.TipoDesconto.Nenhum;
                        ingressoTransacao.valorDesconto = null;
                        ingressoTransacao.precoDesconto = null;
                        ingressoTransacao.taxaServico = Number(ingressoTransacao.taxaServicoOriginal);
                        ingressoTransacao.taxaServicoDesconto = 0;
                        await ingressoTransacao.save();
                    }
                    catch (error) {
                        console.error('Erro ao restaurar valores originais:', error);
                        throw new customError_1.CustomError('Erro ao restaurar valores do ingresso.', 500, '');
                    }
                }
            }));
            // Atualizar o preço total da transação
            const ingressosTransacaoTotal = await Transacao_1.IngressoTransacao.findAll({
                where: { idTransacao }
            });
            transacao.preco = ingressosTransacaoTotal.reduce((preco, ingresso) => preco + Number(ingresso.preco || 0), 0);
            transacao.taxaServico = ingressosTransacaoTotal.reduce((taxa, ingresso) => taxa + Number(ingresso.taxaServico || 0), 0);
            transacao.taxaServicoDesconto = ingressosTransacaoTotal.reduce((taxa, ingresso) => taxa + Number(ingresso.taxaServicoDesconto || 0), 0);
            transacao.valorTotal = ingressosTransacaoTotal.reduce((total, ingresso) => total + Number(ingresso.valorTotal || 0), 0);
            await transacao.save();
            return res.status(200).json({
                message: "Cupom promocional aplicado com sucesso.",
                ingressosAtualizados: ingressosTransacao,
                transacaoAtualizada: transacao
            });
        }
        catch (error) {
            console.error('Erro ao aplicar cupom promocional:', error);
            if (error instanceof customError_1.CustomError) {
                return res.status(error.statusCode).json({ message: error.message });
            }
            next(error);
        }
    },
    getDadosTransacoesPagas: async (req, res, next) => {
        try {
            const { idEvento, dataInicio, dataFim } = req.query;
            if (!idEvento) {
                throw new customError_1.CustomError("ID do evento é obrigatório.", 400, "");
            }
            const transacoesPagas = await Transacao_1.Transacao.findAll({
                where: {
                    status: "Pago",
                    idEvento,
                    dataPagamento: {
                        [sequelize_1.Op.between]: [`${dataInicio} 00:00:00`, `${dataFim} 23:59:59`],
                    },
                },
                raw: true,
            });
            const resumoPorData = {};
            for (const item of transacoesPagas) {
                const dataPagamento = item.dataPagamento
                    ? new Date(item.dataPagamento)
                    : null;
                if (!dataPagamento || isNaN(dataPagamento.getTime())) {
                    console.warn("Transação com data inválida:", item);
                    continue;
                }
                const data = dataPagamento.toISOString().split("T")[0];
                if (!resumoPorData[data]) {
                    resumoPorData[data] = {
                        preco: 0,
                        valorRecebido: 0,
                        valorTaxaProcessamento: 0,
                        transacoes: [],
                    };
                }
                resumoPorData[data].preco += Number(item.preco || 0);
                resumoPorData[data].valorRecebido += Number(item.valorRecebido || 0);
                resumoPorData[data].valorTaxaProcessamento += Number(item.valorTaxaProcessamento || 0);
                resumoPorData[data].transacoes.push(item);
            }
            let resultado = Object.entries(resumoPorData).map(([data, valores]) => ({
                data,
                ...valores,
            }));
            // Cálculo total
            const total = resultado.reduce((acc, curr) => ({
                preco: acc.preco + curr.preco,
                valorRecebido: acc.valorRecebido + curr.valorRecebido,
                valorTaxaProcessamento: acc.valorTaxaProcessamento + curr.valorTaxaProcessamento,
            }), { preco: 0, valorRecebido: 0, valorTaxaProcessamento: 0 });
            // Linha "Total" (sem transações)
            resultado.push({
                data: "Total",
                ...total,
                transacoes: [],
            });
            return res.status(200).json({ data: resultado });
        }
        catch (error) {
            console.error("Erro ao obter transações pagas:", error);
            if (error instanceof customError_1.CustomError) {
                return res
                    .status(error.statusCode)
                    .json({ message: error.message });
            }
            return res.status(500).json({ message: "Erro interno", error: error.message });
        }
    }
};
