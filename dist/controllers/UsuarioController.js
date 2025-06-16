"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Usuario_1 = require("../models/Usuario");
const getRegistros_1 = require("../utils/getRegistros");
const customError_1 = require("../utils/customError");
const Empresa_1 = require("../models/Empresa");
module.exports = {
    async getUsuario(req, res, next) {
        await (0, getRegistros_1.getRegistros)(Usuario_1.Usuario, req, res, next, [
            {
                model: Usuario_1.FuncaoUsuario,
                as: 'funcaoUsuario',
                attributes: ['funcaoUsuario'],
            }
        ]);
    },
    async addUsuario(req, res, next) {
        try {
            const { email, login, senha, nomeCompleto, idFuncaoUsuario, ativo, alterarSenha } = req.body;
            // Validação básica
            if (!email || !login || !senha || !nomeCompleto) {
                // return res.status(400).json({ message: 'Os campos email, login, senha, nomeCompleto são obrigatórios.' });
                throw new customError_1.CustomError('Os campos email, login, senha, nomeCompleto são obrigatórios.', 400, '');
            }
            const registro = await Usuario_1.Usuario.create({ email, login, senha, nomeCompleto, ativo, alterarSenha, idFuncaoUsuario });
            console.log(registro);
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async editUsuario(req, res, next) {
        try {
            const id = req.params.id;
            const { email, login, nomeCompleto, ativo, alterarSenha, idFuncaoUsuario, senha, telefone, sobreNome } = req.body;
            // Validação dos dados (exemplo simples)
            if (!id) {
                throw new customError_1.CustomError('ID do usuário é obrigatório.', 400, '');
            }
            if (!email && !login && !nomeCompleto && ativo === undefined && alterarSenha === undefined) {
                // return res.status(400).json({ message: 'Nenhum campo para atualizar fornecido.' });
                throw new customError_1.CustomError('Nenhum campo para atualizar fornecido.', 400, '');
            }
            // Verificar se o usuário existe
            const registro = await Usuario_1.Usuario.findByPk(id);
            if (!registro) {
                throw new customError_1.CustomError('Usuário não encontrado.', 404, '');
                // return res.status(404).json({ message: 'Usuário não encontrado.' });
            }
            // Atualizar os campos permitidos
            if (email)
                registro.email = email;
            if (login)
                registro.login = login;
            if (senha)
                registro.senha = senha;
            if (nomeCompleto)
                registro.nomeCompleto = nomeCompleto;
            if (sobreNome)
                registro.sobreNome = sobreNome;
            if (idFuncaoUsuario)
                registro.idFuncaoUsuario = idFuncaoUsuario;
            if (ativo !== undefined)
                registro.ativo = ativo;
            if (alterarSenha !== undefined)
                registro.alterarSenha = alterarSenha;
            if (telefone)
                registro.telefone = telefone;
            await registro.save();
            return res.status(200).json(registro);
        }
        catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },
    async deleteUsuario(req, res, next) {
        try {
            const id = req.params.id;
            if (!id) {
                throw new customError_1.CustomError('ID do usuário é obrigatório.', 400, '');
                // return res.status(400).json({ message: 'ID do usuário é obrigatório.' });
            }
            // Verificar se o usuário existe
            const registro = await Usuario_1.Usuario.findByPk(id);
            if (!registro) {
                throw new customError_1.CustomError('Usuário não encontrado.', 404, '');
                // return res.status(404).json({ message: 'Usuário não encontrado.' });
            }
            // Deletar o usuário
            await registro.destroy();
            return res.status(200).json({ message: 'Usuário deletado com sucesso.' });
        }
        catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },
    async getFuncaoUsuario(req, res, next) {
        await (0, getRegistros_1.getRegistros)(Usuario_1.FuncaoUsuario, req, res, next);
    },
    async addFuncaoUsuario(req, res, next) {
        try {
            const { funcaoUsuario } = req.body;
            //   // Validação básica
            if (!funcaoUsuario) {
                throw new customError_1.CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }
            const registro = await Usuario_1.FuncaoUsuario.create({ funcaoUsuario });
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async editFuncaoUsuario(req, res, next) {
        try {
            const id = req.params.id;
            const { funcaoUsuario } = req.body;
            const registro = await Usuario_1.FuncaoUsuario.findByPk(id);
            if (!registro) {
                throw new customError_1.CustomError('Registro não encontrado.', 404, '');
            }
            // Atualizar os campos permitidos
            if (funcaoUsuario)
                registro.funcaoUsuario = funcaoUsuario;
            await registro.save();
            return res.status(200).json(registro);
        }
        catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },
    async deleteFuncaoUsuario(req, res, next) {
        try {
            const id = req.params.id;
            if (!id) {
                throw new customError_1.CustomError('ID do registro é obrigatório.', 400, '');
            }
            // Verificar se o usuário existe
            const registro = await Usuario_1.FuncaoUsuario.findByPk(id);
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
    async getFuncaoUsuarioAcesso(req, res, next) {
        await (0, getRegistros_1.getRegistros)(Usuario_1.FuncaoUsuarioAcesso, req, res, next, [
            {
                model: Usuario_1.FuncaoSistema,
                as: 'funcaoSistema',
                attributes: ['funcaoSistema']
            },
            {
                model: Usuario_1.FuncaoUsuario,
                as: 'funcaoUsuario',
                attributes: ['funcaoUsuario']
            }
        ]);
    },
    async addFuncaoUsuarioAcesso(req, res, next) {
        try {
            const { idFuncaoSistema, idFuncaoUsuario } = req.body;
            //   // Validação básica
            if (!idFuncaoSistema || !idFuncaoUsuario) {
                throw new customError_1.CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }
            const registro = await Usuario_1.FuncaoUsuarioAcesso.create({ idFuncaoSistema, idFuncaoUsuario });
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async deleteFuncaoUsuarioAcesso(req, res, next) {
        try {
            const id = req.params.id;
            if (!id) {
                throw new customError_1.CustomError('ID do registro é obrigatório.', 400, '');
            }
            // Verificar se o usuário existe
            const registro = await Usuario_1.FuncaoUsuarioAcesso.findByPk(id);
            if (!registro) {
                throw new customError_1.CustomError('Registro não encontrado.', 404, '');
            }
            await registro.destroy();
            return res.status(200).json({ message: 'Registro deletado com sucesso.' });
        }
        catch (error) {
            next(error);
        }
    },
    async getFuncaoSistema(req, res, next) {
        await (0, getRegistros_1.getRegistros)(Usuario_1.FuncaoSistema, req, res, next);
    },
    async getUsuarioEmpresa(req, res, next) {
        await (0, getRegistros_1.getRegistros)(Usuario_1.UsuarioEmpresa, req, res, next, [
            {
                model: Empresa_1.Empresa,
                as: 'empresa',
                attributes: ['nomeFantasia']
            }
        ]);
    },
    async addUsuarioEmpresa(req, res, next) {
        try {
            const { usuarioId, empresaId } = req.body;
            //   // Validação básica
            if (!usuarioId || !empresaId) {
                throw new customError_1.CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }
            const registro = await Usuario_1.UsuarioEmpresa.create({ usuarioId, empresaId });
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async deleteUsuarioEmpresa(req, res, next) {
        try {
            const id = req.params.id;
            if (!id) {
                throw new customError_1.CustomError('ID do registro é obrigatório.', 400, '');
            }
            // Verificar se o usuário existe
            const registro = await Usuario_1.UsuarioEmpresa.findByPk(id);
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
};
