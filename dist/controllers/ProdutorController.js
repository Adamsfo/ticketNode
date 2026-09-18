"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const getRegistros_1 = require("../utils/getRegistros");
const customError_1 = require("../utils/customError");
const Produtor_1 = require("../models/Produtor");
const Usuario_1 = require("../models/Usuario");
const TIPOS_ACESSO_VALIDOS = Object.values(Produtor_1.TipoAcesso);
function parsePositiveInt(value, field) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
        throw new customError_1.CustomError(`${field} inválido.`, 400, '');
    }
    return n;
}
function normalizarPayloadProdutorAcesso(body) {
    const idProdutor = parsePositiveInt(body?.idProdutor, 'idProdutor');
    const idUsuario = parsePositiveInt(body?.idUsuario, 'idUsuario');
    const tipoAcesso = String(body?.tipoAcesso || '').trim();
    if (!TIPOS_ACESSO_VALIDOS.includes(tipoAcesso)) {
        throw new customError_1.CustomError('tipoAcesso inválido.', 400, '');
    }
    const payload = {
        idProdutor,
        idUsuario,
        tipoAcesso,
    };
    if (tipoAcesso === Produtor_1.TipoAcesso.PDV) {
        const chave = body?.cliente_chavePOS;
        if (chave !== undefined && chave !== null && String(chave).trim() !== '') {
            payload.cliente_chavePOS = String(chave).trim();
        }
        const posId = body?.pos_id;
        if (posId !== undefined && posId !== null && String(posId).trim() !== '') {
            const parsedPos = Number(posId);
            if (!Number.isFinite(parsedPos) || parsedPos <= 0) {
                throw new customError_1.CustomError('pos_id inválido.', 400, '');
            }
            payload.pos_id = parsedPos;
        }
    }
    return payload;
}
async function assertReferenciasProdutorAcesso(payload) {
    const usuario = await Usuario_1.Usuario.findByPk(payload.idUsuario, {
        attributes: ['id'],
    });
    if (!usuario) {
        throw new customError_1.CustomError('Usuário não encontrado.', 404, '');
    }
    const produtor = await Produtor_1.Produtor.findByPk(payload.idProdutor, {
        attributes: ['id'],
    });
    if (!produtor) {
        throw new customError_1.CustomError('Produtor não encontrado.', 404, '');
    }
}
async function assertSemDuplicataProdutorAcesso(idUsuario, idProdutor, excludeId) {
    const existente = await Produtor_1.ProdutorAcesso.findOne({
        where: { idUsuario, idProdutor },
    });
    if (existente && existente.id !== excludeId) {
        throw new customError_1.CustomError('Já existe acesso para este usuário neste produtor.', 409, '');
    }
}
module.exports = {
    async get(req, res, next) {
        await (0, getRegistros_1.getRegistros)(Produtor_1.Produtor, req, res, next);
    },
    async getAcessoProdutor(req, res, next) {
        console.log('getAcessoProdutor');
        await (0, getRegistros_1.getRegistros)(Produtor_1.ProdutorAcesso, req, res, next);
    },
    async add(req, res, next) {
        try {
            const { nome } = req.body;
            //   // Validação básica
            if (!nome) {
                throw new customError_1.CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }
            const registro = await Produtor_1.Produtor.create(req.body);
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async addAcessoProdutor(req, res, next) {
        try {
            const payload = normalizarPayloadProdutorAcesso(req.body);
            await assertReferenciasProdutorAcesso(payload);
            await assertSemDuplicataProdutorAcesso(payload.idUsuario, payload.idProdutor);
            const registro = await Produtor_1.ProdutorAcesso.create(payload);
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async editAcessoProdutor(req, res, next) {
        try {
            const id = Number(req.params.id);
            if (!id) {
                throw new customError_1.CustomError('ID do registro é obrigatório.', 400, '');
            }
            const registro = await Produtor_1.ProdutorAcesso.findByPk(id);
            if (!registro) {
                throw new customError_1.CustomError('Registro não encontrado.', 404, '');
            }
            const payload = normalizarPayloadProdutorAcesso({
                ...req.body,
                idUsuario: req.body?.idUsuario ?? registro.idUsuario,
                idProdutor: req.body?.idProdutor ?? registro.idProdutor,
                tipoAcesso: req.body?.tipoAcesso ?? registro.tipoAcesso,
                cliente_chavePOS: req.body?.cliente_chavePOS ?? registro.cliente_chavePOS,
                pos_id: req.body?.pos_id ?? registro.pos_id,
            });
            await assertReferenciasProdutorAcesso(payload);
            await assertSemDuplicataProdutorAcesso(payload.idUsuario, payload.idProdutor, registro.id);
            registro.idProdutor = payload.idProdutor;
            registro.idUsuario = payload.idUsuario;
            registro.tipoAcesso = payload.tipoAcesso;
            if (payload.tipoAcesso === Produtor_1.TipoAcesso.PDV) {
                registro.cliente_chavePOS = payload.cliente_chavePOS;
                registro.pos_id = payload.pos_id;
            }
            else {
                registro.cliente_chavePOS = null;
                registro.pos_id = null;
            }
            await registro.save();
            return res.status(200).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async edit(req, res, next) {
        try {
            const id = req.params.id;
            const registro = await Produtor_1.Produtor.findByPk(id);
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
            const registro = await Produtor_1.Produtor.findByPk(id);
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
    },
    async deleteAcessoProdutor(req, res, next) {
        try {
            const id = req.params.id;
            if (!id) {
                throw new customError_1.CustomError('ID do registro é obrigatório.', 400, '');
            }
            // Verificar se o usuário existe
            const registro = await Produtor_1.ProdutorAcesso.findByPk(id);
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
