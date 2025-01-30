"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Empresa_1 = require("../models/Empresa");
const getRegistros_1 = require("../utils/getRegistros");
// import { CustomError } from '../utils/customError'
module.exports = {
    async get(req, res, next) {
        await (0, getRegistros_1.getRegistros)(Empresa_1.Empresa, req, res, next);
    },
    async add(req, res, next) {
        // try {
        //     const { empresaId, tipo, cnpjCpf, insEstadual, insMunicipal, razaoSocialNome, nomeFantasia, consumidorFinal,
        //         contribuinte, cnae, email, telefoneFixo, telefoneCelular, telefoneAlternativo, telefoneWhatsApp } = req.body;
        //     //   // Validação básica
        //     //   if (!email || !login || !senha || !nomeCompleto) {
        //     //     // return res.status(400).json({ message: 'Os campos email, login, senha, nomeCompleto são obrigatórios.' });
        //     //     throw new CustomError('Os campos email, login, senha, nomeCompleto são obrigatórios.', 400, '');
        //     //   }
        //     const registro = await ClienteFornecedor.create({
        //         empresaId, tipo, cnpjCpf, insEstadual, insMunicipal, razaoSocialNome, nomeFantasia, consumidorFinal,
        //         contribuinte, cnae, email, telefoneFixo, telefoneCelular, telefoneAlternativo, telefoneWhatsApp
        //     });
        //     return res.status(201).json(registro);
        // } catch (error) {
        //     next(error);
        // }
    },
    async edit(req, res, next) {
        // try {
        //     const id = req.params.id;
        //     const { tipo, cnpjCpf, insEstadual, insMunicipal, razaoSocialNome, nomeFantasia, consumidorFinal,
        //         contribuinte, cnae, email, telefoneFixo, telefoneCelular, telefoneAlternativo, telefoneWhatsApp } = req.body;
        //     const registro = await ClienteFornecedor.findByPk(id);
        //     if (!registro) {
        //         throw new CustomError('Registro não encontrado.', 404, '');
        //     }
        //     // Atualizar os campos permitidos
        //     if (tipo) registro.tipo = tipo;
        //     if (cnpjCpf) registro.cnpjCpf = cnpjCpf;
        //     if (insEstadual) registro.insEstadual = insEstadual;
        //     if (insMunicipal) registro.insMunicipal = insMunicipal;
        //     if (razaoSocialNome) registro.razaoSocialNome = razaoSocialNome;
        //     if (nomeFantasia) registro.nomeFantasia = nomeFantasia;
        //     if (consumidorFinal) registro.consumidorFinal = consumidorFinal;
        //     if (contribuinte) registro.contribuinte = contribuinte;
        //     if (cnae) registro.cnae = cnae;
        //     if (email) registro.email = email;
        //     if (telefoneFixo) registro.telefoneFixo = telefoneFixo;
        //     if (telefoneCelular) registro.telefoneCelular = telefoneCelular;
        //     if (telefoneAlternativo) registro.telefoneAlternativo = telefoneAlternativo;
        //     if (telefoneWhatsApp) registro.telefoneWhatsApp = telefoneWhatsApp;
        //     await registro.save();
        //     return res.status(200).json(registro);
        // } catch (error) {
        //     next(error); // Passa o erro para o middleware de tratamento de erros
        // }
    },
    async delete(req, res, next) {
        // try {
        //   const id = req.params.id;
        //   if (!id) {
        //     throw new CustomError('ID do registro é obrigatório.', 400, '');            
        //   }
        //   // Verificar se o usuário existe
        //   const registro = await ClienteFornecedor.findByPk(id);
        //   if (!registro) {
        //     throw new CustomError('Registro não encontrado.', 404, '');
        //     // return res.status(404).json({ message: 'Usuário não encontrado.' });
        //   }
        //   // Deletar o usuário
        //   await registro.destroy();
        //   return res.status(200).json({ message: 'Registro deletado com sucesso.' });
        // } catch (error) {
        //   next(error); // Passa o erro para o middleware de tratamento de erros
        // }
    }
};
