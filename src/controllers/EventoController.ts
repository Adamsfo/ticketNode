import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { Evento } from "../models/Evento";
import { Produtor } from "../models/Produtor";
import fs from "fs";
import sharp from "sharp";
import { uploadStorage } from "../utils/uploadStorage";

module.exports = {
    async get(req: any, res: any, next: any) {
        const result = await getRegistros(Evento, req, res, next,
            [
                {
                    model: Produtor,
                    as: 'Produtor',
                    attributes: ['logo'],
                }
            ], true
        )

        const { data, meta } = result ?? { data: [], meta: { totalItems: 0, totalPages: 0, currentPage: 0, pageSize: 0 } };

        const dataComQrCode = await Promise.all(
            data.map(async (registro: any) => {
                try {
                    let imagemBase64 = null;
                    if (registro.imagem) {
                        const filePath = uploadStorage.resolvePath(registro.imagem);
                        if (fs.existsSync(filePath)) {
                            const buffer = await sharp(filePath)
                                .resize({ width: 390 })
                                .png({
                                    compressionLevel: 9,
                                    adaptiveFiltering: true,
                                })
                                .toBuffer();

                            imagemBase64 = buffer.toString("base64");
                        }
                    }

                    return {
                        ...registro.toJSON?.() ?? registro,
                        imagemBase64,
                    };
                } catch (err) {
                    console.error("Erro ao converter imagem:", err);
                    return {
                        ...registro.toJSON?.() ?? registro,
                        imagemBase64: null,
                    };
                }
            })
        );

        return res.status(200).json({ data: dataComQrCode, meta });
    },

    async add(req: any, res: any, next: any) {
        try {
            const { nome, data_hora_inicio, data_hora_fim, latitude, longitude, endereco, idUsuario, idProdutor } = req.body;

            //   // Validação básica
            if (!nome || !data_hora_inicio || !data_hora_fim || !latitude || !longitude || !endereco || !idUsuario || !idProdutor) {
                throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }

            const registro = await Evento.create(req.body);
            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async edit(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            const registro = await Evento.findByPk(id);
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
            const registro = await Evento.findByPk(id);
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
