import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { HistoricoTransacao, IngressoTransacao, Transacao } from "../models/Transacao";
import { Ingresso } from "../models/Ingresso";
import { EventoIngresso } from "../models/EventoIngresso";
import { Evento } from "../models/Evento";
import { CupomPromocional, CupomPromocionalValidade, TipoDesconto } from "../models/CupomPromocional";
import { NUMBER, Op } from 'sequelize';
import { TipoIngresso } from "../models/TipoIngresso";

export const addHistorico = async (idTransacao: number, idUsuario: number, descricao: string) => {
    try {
        const data = new Date(); // Data atual
        await HistoricoTransacao.create({ idTransacao, idUsuario, data, descricao });
        return true; // Retorna true se a operação for bem-sucedida
    }
    catch (error) {
        console.error('Erro ao adicionar histórico:', error);
        return false; // Retorna false se ocorrer um erro
    }
}

module.exports = {
    async get(req: any, res: any, next: any) {
        await getRegistros(Transacao, req, res, next,
            // [
            //     {
            //         model: IngressoTransacao,
            //         as: 'IngressoTransacao',
            //         // attributes: ['idIngresso, preco, taxaServico, valorTotal'],
            //     }
            // ]
        )
    },

    async getIngressoTransacao(req: any, res: any, next: any) {
        await getRegistros(IngressoTransacao, req, res, next,
            [
                {
                    model: Ingresso,
                    as: 'Ingresso',
                    include: [
                        {
                            model: EventoIngresso,
                            as: 'EventoIngresso',
                            // attributes: ['idEventoIngresso', 'nomeEvento', 'dataEvento']
                            include: [
                                {
                                    model: TipoIngresso,
                                    as: 'TipoIngresso',
                                    attributes: ['descricao'], // 🔥 Aqui você retorna só a descrição
                                }
                            ]
                        },
                        {
                            model: Evento,
                            as: 'Evento',
                            // attributes: ['idEventoIngresso', 'nomeEvento', 'dataEvento']
                        }
                    ],
                }
            ]
        )
    },

    async add(req: any, res: any, next: any) {
        try {
            console.log('addTransacao', req.body)
            const { idUsuario, preco, taxaServico, valorTotal } = req.body;
            const dataTransacao = new Date(); // Data atual
            const status = 'Aguardando pagamento'; // Definindo o status como "Reservado" por padrão

            //   // Validação básica
            if (!preco || !taxaServico || !valorTotal || !idUsuario) {
                throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }

            const registro = await Transacao.create({ ...req.body, status, dataTransacao, aceiteCompra: true });
            // Adiciona o histórico após a criação do ingresso
            await addHistorico(registro.id, idUsuario, 'Transação criada com sucesso.');

            //itens da transação
            //Primeiro criar a transação 
            //depois criar os ingressos e enviar o idTransacao para cada ingresso e criar o item da transação
            // caso nao criar todos os ingressos cancelar a transacao
            // atualizar a transacao depois de criado todos os ingressos

            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async edit(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            const registro = await Transacao.findByPk(id);
            if (!registro) {
                throw new CustomError('Registro não encontrado.', 404, '');
            }

            // Atualizar apenas os campos que estão definidos (não são undefined)
            Object.keys(req.body).forEach(field => {
                if (req.body[field] !== undefined && field in registro) {
                    (registro as any)[field] = req.body[field];
                }
            });

            await registro.save();
            return res.status(200).json(registro);
        } catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },

    async delete(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            if (!id) {
                throw new CustomError('ID do registro é obrigatório.', 400, '');
            }

            // Verificar se o usuário existe
            const registro = await Transacao.findByPk(id);
            if (!registro) {
                throw new CustomError('Registro não encontrado.', 404, '');
                // return res.status(404).json({ message: 'Usuário não encontrado.' });
            }

            // Deletar o usuário
            await registro.destroy();

            return res.status(200).json({ message: 'Registro deletado com sucesso.' });
        } catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },

    getTransacaoCupomDesconto1: async (req: any, res: any, next: any) => {
        try {
            const { idTransacao, nomeCupomDesconto } = req.body;

            if (!idTransacao || !nomeCupomDesconto) {
                throw new CustomError('ID da transação e Nome Cupom são obrigatório.', 400, '');
            }

            // Verifica se a transação existe            
            const transacao = await Transacao.findByPk(idTransacao)

            if (!transacao) {
                throw new CustomError('Transação não encontrada.', 404, '');
            }

            // Verifica se o cupom de desconto existe
            const cupomDesconto = await CupomPromocional.findOne({
                where: {
                    nome: nomeCupomDesconto,
                }
            });

            if (!cupomDesconto) {
                throw new CustomError('Cupom promocional não encontrado.', 404, '');
            }

            const ingressosTransacao = await IngressoTransacao.findAll({
                where: {
                    idTransacao: idTransacao,
                },
            });

            if (!ingressosTransacao || ingressosTransacao.length === 0) {
                throw new CustomError('Nenhum ingresso encontrado para esta transação.', 404, '');
            }

            for (const ingressoTransacao of ingressosTransacao) {
                const ingresso = await Ingresso.findByPk(ingressoTransacao.idIngresso);
                if (!ingresso) {
                    throw new CustomError(`Ingresso com ID ${ingressoTransacao.idIngresso} não encontrado.`, 404, '');
                }

                const eventoIngresso = await EventoIngresso.findOne({
                    where: {
                        id: ingresso.idEventoIngresso,
                        idCupomPromocional: cupomDesconto.id,
                    }
                });

                if (eventoIngresso) {
                    console.log('Evento Ingresso encontrado:', eventoIngresso);
                    const cupomPromocialValidade = await CupomPromocionalValidade.findOne({
                        where: {
                            idCupomPromocional: eventoIngresso.idCupomPromocional, // ou o ID que você quer comparar
                            dataInicial: { [Op.lte]: new Date() },
                            dataFinal: { [Op.gte]: new Date() },
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

        } catch (error) {
            console.error('Erro ao aplicar cupom promocional:', error);
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ message: error.message });
            }
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },

    getTransacaoCupomDesconto: async (req: any, res: any, next: any) => {
        try {
            const { idTransacao, nomeCupomDesconto } = req.body;

            if (!idTransacao || !nomeCupomDesconto) {
                throw new CustomError('ID da transação e Nome Cupom são obrigatórios.', 400, '');
            }

            const transacao = await Transacao.findByPk(idTransacao);
            if (!transacao) {
                throw new CustomError('Transação não encontrada.', 404, '');
            }

            const cupomDesconto = await CupomPromocional.findOne({
                where: { nome: nomeCupomDesconto }
            });
            if (!cupomDesconto) {
                throw new CustomError('Cupom promocional não encontrado.', 404, '');
            }

            const validadeCupom = await CupomPromocionalValidade.findOne({
                where: {
                    idCupomPromocional: cupomDesconto.id,
                    dataInicial: { [Op.lte]: new Date() },
                    dataFinal: { [Op.gte]: new Date() },
                }
            });

            if (!validadeCupom) {
                throw new CustomError('Cupom fora da validade.', 400, '');
            }

            const ingressosTransacao = await IngressoTransacao.findAll({
                where: { idTransacao }
            });

            if (!ingressosTransacao.length) {
                throw new CustomError('Nenhum ingresso encontrado para esta transação.', 404, '');
            }

            await Promise.all(ingressosTransacao.map(async (ingressoTransacao) => {
                const ingresso = await Ingresso.findByPk(ingressoTransacao.idIngresso);
                if (!ingresso) {
                    throw new CustomError(`Ingresso ID ${ingressoTransacao.idIngresso} não encontrado.`, 404, '');
                }

                const eventoIngresso = await EventoIngresso.findOne({
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

                        if (!ingressoTransacao.precoOriginal) {
                            throw new CustomError('Preço original do ingresso não definido.', 400, '');
                        }

                        ingressoTransacao.idCupomPromocionalValidade = validadeCupom.id;
                        ingressoTransacao.tipoDesconto = cupomDesconto.tipoDesconto as TipoDesconto;
                        ingressoTransacao.valorDesconto = cupomDesconto.valorDesconto;
                        ingressoTransacao.precoDesconto = Number(0);

                        if (cupomDesconto.tipoDesconto === 'Percentual') {
                            ingressoTransacao.precoDesconto = Number((ingressoTransacao.precoOriginal * cupomDesconto.valorDesconto) / 100);
                        } else if (cupomDesconto.tipoDesconto === 'Fixo') {
                            ingressoTransacao.precoDesconto = Number(cupomDesconto.valorDesconto);
                        }

                        if (cupomDesconto.valorDescontoTaxa) {
                            ingressoTransacao.taxaServico = Number(ingressoTransacao.taxaServico) - Number(cupomDesconto.valorDescontoTaxa);
                            ingressoTransacao.taxaServicoDesconto = Number(cupomDesconto.valorDescontoTaxa);
                        }

                        ingressoTransacao.preco = Number(ingressoTransacao.precoOriginal) - Number(ingressoTransacao.precoDesconto);
                        ingressoTransacao.valorTotal = Number(ingressoTransacao.preco) + Number(ingressoTransacao.taxaServico);

                        await ingressoTransacao.save();
                    } catch (error) {
                        console.error('Erro ao calcular desconto:', error);
                        throw new CustomError('Erro ao calcular desconto do ingresso.', 500, '');
                    }
                } else {
                    // 🚩 REVERTER PARA VALORES ORIGINAIS
                    try {
                        console.log('Evento Ingresso não encontrado promicional');
                        if (ingressoTransacao.precoOriginal !== null && ingressoTransacao.precoOriginal !== undefined) {
                            ingressoTransacao.preco = Number(ingressoTransacao.precoOriginal);
                            ingressoTransacao.valorTotal = Number(ingressoTransacao.preco) + Number(ingressoTransacao.taxaServico);
                        }

                        ingressoTransacao.idCupomPromocionalValidade = null;
                        ingressoTransacao.tipoDesconto = TipoDesconto.Nenhum;
                        ingressoTransacao.valorDesconto = null;
                        ingressoTransacao.precoDesconto = null;
                        ingressoTransacao.taxaServicoDesconto = 0;

                        await ingressoTransacao.save();
                    } catch (error) {
                        console.error('Erro ao restaurar valores originais:', error);
                        throw new CustomError('Erro ao restaurar valores do ingresso.', 500, '');
                    }
                }
            }));

            // Atualizar o preço total da transação
            const ingressosTransacaoTotal = await IngressoTransacao.findAll({
                where: { idTransacao }
            });
            transacao.preco = ingressosTransacaoTotal.reduce(
                (preco, ingresso) => preco + Number(ingresso.preco || 0),
                0
            );
            transacao.taxaServico = ingressosTransacaoTotal.reduce(
                (taxa, ingresso) => taxa + Number(ingresso.taxaServico || 0),
                0
            );

            transacao.taxaServicoDesconto = ingressosTransacaoTotal.reduce(
                (taxa, ingresso) => taxa + Number(ingresso.taxaServicoDesconto || 0),
                0
            );

            transacao.valorTotal = ingressosTransacaoTotal.reduce(
                (total, ingresso) => total + Number(ingresso.valorTotal || 0),
                0
            );

            await transacao.save();

            return res.status(200).json({
                message: "Cupom promocional aplicado com sucesso.",
                ingressosAtualizados: ingressosTransacao,
                transacaoAtualizada: transacao
            });

        } catch (error) {
            console.error('Erro ao aplicar cupom promocional:', error);
            if (error instanceof CustomError) {
                return res.status(error.statusCode).json({ message: error.message });
            }
            next(error);
        }
    }

}
