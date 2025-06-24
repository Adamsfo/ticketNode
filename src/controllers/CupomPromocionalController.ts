import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { CupomPromocional, CupomPromocionalValidade } from "../models/CupomPromocional"

module.exports = {
    async get(req: any, res: any, next: any) {
        await getRegistros(CupomPromocional, req, res, next)
    },

    async getCupomPromocionalValidade(req: any, res: any, next: any) {
        await getRegistros(CupomPromocionalValidade, req, res, next)
    },

    async add(req: any, res: any, next: any) {
        try {
            const { nome, idProdutor } = req.body;

            //   // Validação básica
            if (!nome || !idProdutor) {
                throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }

            const registro = await CupomPromocional.create(req.body);
            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async addCupomPromocionalValidade(req: any, res: any, next: any) {
        try {
            const { idCupomPromocional, dataInicial, dataFinal } = req.body;

            //   // Validação básica
            if (!idCupomPromocional || !dataInicial || !dataFinal) {
                throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }

            const registro = await CupomPromocionalValidade.create(req.body);
            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async edit(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            const registro = await CupomPromocional.findByPk(id);
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
            const registro = await CupomPromocional.findByPk(id);
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

    async deleteCupomPromocionalValidade(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            if (!id) {
                throw new CustomError('ID do registro é obrigatório.', 400, '');
            }

            // Verificar se o usuário existe
            const registro = await CupomPromocionalValidade.findByPk(id);
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

    async editCupomPromocionalValidade(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            const registro = await CupomPromocionalValidade.findByPk(id);
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
}
