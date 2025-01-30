import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { Ticket, TicketHistorico } from "../models/Ticket";
import { Torneio, TorneioItem } from "../models/Torneio";
import { Usuario } from "../models/Usuario";
import { ClienteFornecedor } from "../models/ClienteFornecedor";
import { Pagamento } from "../models/Pagamento";
import TorneioService from "./TorneioService";

module.exports = {
    async get(req: any, res: any, next: any) {
        await getRegistros(Ticket, req, res, next, [
            {
                model: ClienteFornecedor,
                as: 'ClienteFornecedor',
                attributes: ['razaoSocialNome'],
            },
            {
                model: Torneio,
                as: 'torneio',
                attributes: ['descricao'],
            },
            {
                model: TorneioItem,
                as: 'torneioItem',
                attributes: ['descricao'],
            }
        ]);
    },

    async getHistorico(req: any, res: any, next: any) {
        await getRegistros(TicketHistorico, req, res, next);
    },

    async add(req: any, res: any, next: any) {
        try {
            const { torneioId, clienteId, empresaId, torneioItemId, usuarioId, metodoPagamento } = req.body;

            // Validação básica
            if (!torneioId || !clienteId || !empresaId || !torneioItemId || !usuarioId || !metodoPagamento) {
                throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }

            const torneioItem = await TorneioItem.findOne({ where: { id: torneioItemId } })
            if (!torneioItem) {
                throw new CustomError('Item do Torneio não encontrado para gerar Ticket.', 404, '');
            }

            const usuario = await Usuario.findOne({ where: { id: usuarioId } });

            let pagamento;
            if (metodoPagamento === 'Pagamento') {
                pagamento = await Pagamento.create({
                    valor: torneioItem.totalInscricao ?? 0,
                    metodo: req.body.metodoPagamento,
                    empresaId: empresaId,
                })
            }

            const registro = await Ticket.create({
                ...req.body,
                status: 'PENDENTE',
                valorInscricao: torneioItem.valorInscricao,
                taxaAdm: torneioItem.taxaAdm,
                rake: torneioItem.rake,
                fichas: torneioItem.fichas,
                clienteIdPagou: clienteId,
                metodoPagamento: metodoPagamento,
                pagamentoId: pagamento && pagamento.id
            });

            await TicketHistorico.create({
                ticketId: registro.id,
                descricao: `Ticket criado por ${usuario?.nomeCompleto}`,
                usuarioId: usuarioId,
                data: new Date(),
                status: registro.status
            });

            if (metodoPagamento === 'Crédito na Conta') {
                registro.status = 'DISPONÍVEL';
                registro.save()
                await TicketHistorico.create({
                    ticketId: registro.id,
                    descricao: `Ticket disponibilizado por ${metodoPagamento} pelo usuário ${usuario?.nomeCompleto}`,
                    usuarioId: usuarioId,
                    data: new Date(),
                    status: registro.status
                });
            }

            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async ticketUtilizado(req: any, res: any, next: any) {
        try {
            const id = req.params.id;
            const { usuarioId } = req.body;

            if (!usuarioId) {
                throw new CustomError('Usuário não informado.', 400, '');
            }

            if (!id) {
                throw new CustomError('Id do ticket não informado.', 400, '');
            }

            const registro = await Ticket.findByPk(id);
            if (!registro) {
                throw new CustomError('Registro não encontrado.', 404, '');
            }

            if (registro.status !== 'DISPONÍVEL') {
                throw new CustomError('Ticket não esta disponível para ser utilizado!', 400, '');
            }

            registro.status = 'UTILIZADO';

            await registro.save();

            const usuario = await Usuario.findOne({ where: { id: req.body.usuarioId } });

            if (!usuario) {
                throw new CustomError('Usuário não encontrado.', 404, '');
            }

            await TicketHistorico.create({
                ticketId: registro.id,
                descricao: `Ticket utilizado, entrada realizada pelo floor ${usuario?.nomeCompleto}`,
                usuarioId: usuario.id,
                data: new Date(),
                status: registro.status
            });

            TorneioService.atualizaTorneio();

            return res.status(200).json(registro);
        } catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },

}
