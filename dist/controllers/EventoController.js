"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const getRegistros_1 = require("../utils/getRegistros");
const customError_1 = require("../utils/customError");
const Evento_1 = require("../models/Evento");
const Produtor_1 = require("../models/Produtor");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const sharp_1 = __importDefault(require("sharp"));
module.exports = {
    async get(req, res, next) {
        // await getRegistros(Evento, req, res, next,
        //     [
        //         {
        //             model: Produtor,
        //             as: 'Produtor',
        //             attributes: ['logo'],
        //         }
        //     ]
        // )
        const result = await (0, getRegistros_1.getRegistros)(Evento_1.Evento, req, res, next, [
            {
                model: Produtor_1.Produtor,
                as: 'Produtor',
                attributes: ['logo'],
            }
        ], true);
        const { data, meta } = result ?? { data: [], meta: { totalItems: 0, totalPages: 0, currentPage: 0, pageSize: 0 } };
        const dataComQrCode = await Promise.all(data.map(async (registro) => {
            try {
                const filePath = path_1.default.join(__dirname.replace("\controllers", ""), 'public/uploads', registro.imagem); // caminho físico no servidor                    
                let imagemBase64 = null;
                console.log("Caminho da imagem:", filePath);
                if (fs_1.default.existsSync(filePath)) {
                    console.log("Caminho da imagem existe:", filePath);
                    // Redimensiona para largura 320px e converte em PNG
                    const buffer = await (0, sharp_1.default)(filePath)
                        .resize({ width: 350 }) // largura ajustada para bobina
                        .png({
                        compressionLevel: 9, // máxima compressão PNG
                        adaptiveFiltering: true, // melhora compressão em imagens simples
                    })
                        .toBuffer();
                    imagemBase64 = buffer.toString("base64");
                }
                return {
                    ...registro.toJSON?.() ?? registro,
                    imagemBase64,
                };
            }
            catch (err) {
                console.error("Erro ao converter imagem:", err);
                return {
                    ...registro.toJSON?.() ?? registro,
                    imagemBase64: null,
                };
            }
        }));
        console.log("Data enviada:", dataComQrCode);
        return res.status(200).json({ data: dataComQrCode, meta });
    },
    async add(req, res, next) {
        try {
            const { nome, data_hora_inicio, data_hora_fim, latitude, longitude, endereco, idUsuario, idProdutor } = req.body;
            //   // Validação básica
            if (!nome || !data_hora_inicio || !data_hora_fim || !latitude || !longitude || !endereco || !idUsuario || !idProdutor) {
                throw new customError_1.CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }
            const registro = await Evento_1.Evento.create(req.body);
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async edit(req, res, next) {
        try {
            const id = req.params.id;
            const registro = await Evento_1.Evento.findByPk(id);
            if (!registro) {
                throw new customError_1.CustomError('Registro não encontrado.', 404, '');
            }
            // Atualizar apenas os campos que estão definidos (não são undefined)
            Object.keys(req.body).forEach(field => {
                if (req.body[field] !== undefined && field in registro) {
                    registro[field] = req.body[field];
                }
            });
            await registro.save();
            return res.status(200).json(registro);
        }
        catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },
    async delete(req, res, next) {
        try {
            const id = req.params.id;
            if (!id) {
                throw new customError_1.CustomError('ID do registro é obrigatório.', 400, '');
            }
            // Verificar se o usuário existe
            const registro = await Evento_1.Evento.findByPk(id);
            if (!registro) {
                throw new customError_1.CustomError('Registro não encontrado.', 404, '');
                // return res.status(404).json({ message: 'Usuário não encontrado.' });
            }
            // Deletar o usuário
            await registro.destroy();
            return res.status(200).json({ message: 'Registro deletado com sucesso.' });
        }
        catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    }
};
