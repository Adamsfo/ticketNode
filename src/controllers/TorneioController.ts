import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { Blind, BlindItem, EstruturaTorneio, EstruturaTorneioItem } from '../models/EstruturaTorneio';
import { Torneio, TorneioBlindItem, TorneioItem } from "../models/Torneio";
import TorneioService from "./TorneioService";

module.exports = {
    async get(req: any, res: any, next: any) {
        await getRegistros(Torneio, req, res, next, [
            {
                model: TorneioBlindItem,
                as: 'blindItem',
            }
        ]);
    },

    async add(req: any, res: any, next: any) {
        try {
            const { descricao, blindId, empresaId, estruturaId, dataInicio } = req.body;

            console.log('entrou aquiiiiiiiiiiiii')

            // Validação básica
            if (!descricao || !blindId || !empresaId || !estruturaId) {
                throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }

            const blinds = await BlindItem.findAll({
                where: { blindId },
                order: [['order', 'ASC']], // Ordenar pelo campo 'order' de forma crescente (ASC). Use 'DESC' para decrescente.
            })
            if (!blinds) {
                throw new CustomError('Blinds não encontrados.', 404, '');
            }

            const registro = await Torneio.create({
                ...req.body, status: 'Criado',
                tempoRestanteNivel: blinds[0].duracao * 60
            });

            const torneioBlindItems = blinds.map(blind => ({
                nivel: blind.nivel,
                smallBlind: blind.smallBlind,
                bigBlind: blind.bigBlind,
                duracao: blind.duracao,
                ante: blind.ante,
                order: blind.order,
                torneioId: registro.id,
                // Adicione outros campos conforme necessário
            }))
            await TorneioBlindItem.bulkCreate(torneioBlindItems);

            const primeiroNivel = await TorneioBlindItem.findOne({ where: { torneioId: registro.id }, order: [['order', 'ASC']] });
            if (primeiroNivel) {
                registro.blindItemAtual = primeiroNivel.id;
            } else {
                throw new CustomError('Primeiro nível não encontrado.', 404, '');
            }

            registro.save()

            const estruturaItems = await EstruturaTorneioItem.findAll({ where: { estruturaId } });
            if (!estruturaItems) {
                throw new CustomError('Estrutura de torneio não encontrada.', 404, '');
            }
            const toneioItems = estruturaItems.map(item => ({
                descricao: item.descricao,
                fichas: item.fichas,
                limiteJogador: item.limiteJogador,
                qtdePorJogador: item.qtdePorJogador,
                valorInscricao: item.valorInscricao,
                totalInscricao: item.totalInscricao,
                taxaAdm: item.taxaAdm,
                tipoRake: item.tipoRake,
                rake: item.rake,
                torneioId: registro.id,
                // Adicione outros campos conforme necessário
            }))

            console.log(toneioItems)
            await TorneioItem.bulkCreate(toneioItems);

            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async edit(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            const registro = await Torneio.findByPk(id);
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
            const registro = await Torneio.findByPk(id);
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

    async iniciar(req: any, res: any, next: any) {
        try {
            const torneio: Torneio = await TorneioService.iniciarTorneio((torneioAtualizado: Torneio) => {
                require('./TorneioWebSocket').enviarAtualizacaoTorneio(torneioAtualizado);
            });
            res.json({ message: 'Torneio iniciado!', torneio });
        } catch (err: any) {
            res.status(400).send(err.message);
        }
    },

    async parar(req: any, res: any, next: any) {
        try {
            const torneio: Torneio = await TorneioService.pararTorneio();
            res.json({ message: 'Torneio parado!', torneio });
        } catch (err: any) {
            res.status(400).send(err.message);
        }
    },

    async status(req: any, res: any, next: any) {
        try {
            const status: Torneio | null = await TorneioService.buscarTorneioEmAndamentoOuParado();
            if (!status) {
                res.status(404).send('Nenhum torneio encontrado.');
            } else {
                res.json(status);
            }
        } catch (err: any) {
            res.status(500).send(err.message);
        }
    }
}
