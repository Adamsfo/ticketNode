import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { EventoIngresso } from "../models/EventoIngresso";
import { TipoIngresso } from "../models/TipoIngresso";
import { CupomPromocional } from "../models/CupomPromocional";

module.exports = {
    async get(req: any, res: any, next: any) {
        await getRegistros(EventoIngresso, req, res, next,
            [
                {
                    model: TipoIngresso,
                    as: 'TipoIngresso',
                    attributes: ['descricao'],
                },
                {
                    model: CupomPromocional,
                    as: 'CupomPromocional',
                    attributes: ['nome'],
                }
            ],

        )
    },

    async add(req: any, res: any, next: any) {
        try {
            const { nome, idTipoIngresso, idEvento, qtde, preco, taxaServico, lote, valor } = req.body;

            //   // Validação básica
            if (!nome || !idTipoIngresso || !idEvento || !qtde || !preco || !taxaServico || !lote || !valor) {
                throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }

            const registro = await EventoIngresso.create(req.body);
            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async edit(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            const registro = await EventoIngresso.findByPk(id);
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
            const registro = await EventoIngresso.findByPk(id);
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
