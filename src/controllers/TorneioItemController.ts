import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { TorneioItem } from "../models/Torneio";


module.exports = {
    async get(req: any, res: any, next: any) {
        await getRegistros(TorneioItem, req, res, next)
    },

    async add(req: any, res: any, next: any) {
        try {
            const { fichas, valorInscricao, estruturaId } = req.body;

            if (!fichas || !valorInscricao || !estruturaId) {
                throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }

            const attributes = TorneioItem.getAttributes();
            console.log(attributes)

            Object.keys(req.body).forEach(field => {
                if (req.body[field] !== undefined) {
                    if ((attributes as any)[field].type.key === 'DECIMAL' && !req.body[field].toString().includes('.')) {
                        (req.body)[field] = req.body[field] / 100;
                    } else {
                        (req.body)[field] = req.body[field];
                    }
                }
            });

            const registro = await TorneioItem.create(req.body);

            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async edit(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            const registro = await TorneioItem.findByPk(id);
            if (!registro) {
                throw new CustomError('Registro não encontrado.', 404, '');
            }

            const attributes = TorneioItem.getAttributes();
            console.log(attributes)

            // Atualizar apenas os campos que estão definidos (não são undefined)
            Object.keys(req.body).forEach(field => {
                if (req.body[field] !== undefined && field in registro) {
                    if ((attributes as any)[field].type.key === 'DECIMAL' && (attributes as any)[field].type._scale == 2 && !req.body[field].toString().includes('.')) {
                        (registro as any)[field] = req.body[field] / 100;
                    } else {
                        (registro as any)[field] = req.body[field];
                    }
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
            const registro = await TorneioItem.findByPk(id);
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
