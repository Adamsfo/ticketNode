import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { HistoricoTransacao, IngressoTransacao, Transacao } from "../models/Transacao";
import { Ingresso } from "../models/Ingresso";
import { EventoIngresso } from "../models/EventoIngresso";
import { Evento } from "../models/Evento";

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
    }
}
