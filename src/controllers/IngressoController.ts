import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { HistoricoIngresso, Ingresso } from "../models/Ingresso";
import { EventoIngresso } from "../models/EventoIngresso";
import { IngressoTransacao } from "../models/Transacao";

export const addIngressoTransacao = async (idTransacao: number, idIngresso: number, preco: number, taxaServico: number, valorTotal: number) => {
    try {
        await IngressoTransacao.create({ idTransacao, idIngresso, preco, taxaServico, valorTotal });
    } catch (error) {
        console.error('Erro ao adicionar ingresso à transação:', error);
    }
}

const addHistorico = async (idIngresso: number, idUsuario: number, descricao: string) => {
    try {
        const data = new Date(); // Data atual
        await HistoricoIngresso.create({ idIngresso, idUsuario, data, descricao });
    }
    catch (error) {
        console.error('Erro ao adicionar histórico:', error);
    }
}

module.exports = {
    async get(req: any, res: any, next: any) {
        await getRegistros(Ingresso, req, res, next)
    },

    async add(req: any, res: any, next: any) {
        try {
            const { idEvento, idEventoIngresso, idTipoIngresso, idUsuario, idTransacao } = req.body;
            const status = 'Reservado'; // Definindo o status como "Reservado" por padrão

            //   // Validação básica
            if (!idEvento || !idEventoIngresso || !idTipoIngresso || !idUsuario || !idTransacao) {
                throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }

            const dataValidade = new Date(); // Data atual
            const dataNascimento = new Date(); // Data atual

            const eventoIngresso = await EventoIngresso.findByPk(idEventoIngresso);
            if (eventoIngresso?.nome.includes('Antecipado')) {
                dataValidade.setDate(dataValidade.getDate() + 1);
            }

            const registro = await Ingresso.create({ ...req.body, status, dataValidade, dataNascimento });
            // Adiciona o histórico após a criação do ingresso
            await addHistorico(registro.id, idUsuario, 'Ingresso criado com sucesso.');

            if (!eventoIngresso) {
                throw new CustomError('EventoIngresso não encontrado.', 404, '');
            }

            await addIngressoTransacao(idTransacao, registro.id, eventoIngresso.preco, eventoIngresso.taxaServico, eventoIngresso.valor);
            // Adiciona o histórico após a criação do ingresso
            await addHistorico(registro.id, idUsuario, 'Vinculado a transação ' + idTransacao);
            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async edit(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            const registro = await Ingresso.findByPk(id);
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
            const registro = await Ingresso.findByPk(id);
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
