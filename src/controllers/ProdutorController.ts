import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { Produtor, ProdutorAcesso } from "../models/Produtor";

module.exports = {
    async get(req: any, res: any, next: any) {
        await getRegistros(Produtor, req, res, next)
    },

    async getAcessoProdutor(req: any, res: any, next: any) {
        console.log('getAcessoProdutor')
        await getRegistros(ProdutorAcesso, req, res, next)
    },

    async add(req: any, res: any, next: any) {
        try {
            const { nome } = req.body;

            //   // Validação básica
            if (!nome) {
                throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }

            const registro = await Produtor.create(req.body);
            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async addAcessoProdutor(req: any, res: any, next: any) {
        try {
            const { idProdutor, idUsuario, tipoAcesso } = req.body;

            //   // Validação básica
            if (!idProdutor || !idUsuario || !tipoAcesso) {
                throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }

            const registro = await ProdutorAcesso.create(req.body);
            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async edit(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            const registro = await Produtor.findByPk(id);
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
            const registro = await Produtor.findByPk(id);
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

    async deleteAcessoProdutor(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            if (!id) {
                throw new CustomError('ID do registro é obrigatório.', 400, '');
            }

            // Verificar se o usuário existe
            const registro = await ProdutorAcesso.findByPk(id);
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
