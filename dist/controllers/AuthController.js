"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Usuario_1 = require("../models/Usuario");
const jwtUtils_1 = require("../utils/jwtUtils");
const customError_1 = require("../utils/customError");
const twilioService_1 = require("../utils/twilioService");
const resend_1 = require("../utils/resend");
const Visitas_1 = require("../models/Visitas");
// import chatpro from '@api/chatpro'
const codeStore = new Map();
function formatPhoneToE164(phone) {
    // Remove caracteres não numéricos
    const cleaned = phone.replace(/\D/g, '');
    // Adiciona o código do país se não estiver presente
    return cleaned.startsWith('55') ? `+${cleaned}` : `+55${cleaned}`;
}
// Envia código de verificação por e-mail usando Resend
const enviaCodigoEmail = async (email, codigo) => {
    try {
        if (!email) {
            throw new Error('Email é obrigatório');
        }
        const response = await resend_1.resend.emails.send({
            from: 'Jango Ingressos <no-reply@jangoingressos.com.br>',
            to: [email],
            subject: 'Seu código de verificação',
            html: `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <h2>Olá!</h2>
          <p>Seu código de verificação é:</p>
          <h1 style="color:#007BFF;">${codigo}</h1>
          <p>Este código expira em 15 minutos.</p>
          <p>Se você não solicitou esse código, ignore este e-mail.</p>
          <br/>
          <small>Jango Ingressos © ${new Date().getFullYear()}</small>
          <small>Desenvolvido por Tanz Tecnologia Ltda</small>
        </div>
      `,
        });
        if (response.error) {
            console.error('Erro ao enviar e-mail via Resend:', response.error);
        }
    }
    catch (error) {
        console.error('Erro geral no envio de e-mail:', error);
    }
};
async function enviarCodigoAtivacaoChatPro(numeroCliente, codigo) {
    // chatpro.auth('d597037283078574746e95b4e78ddd52');
    // chatpro.send_message({
    //   number: numeroCliente,
    //   message: `Seu código de verificação é: ${codigo}. Não compartilhe com ninguém.`
    // }, { instance_id: 'chatpro-4p8b76i8oq' })
    //   .then(({ data }) => console.log(data))
    //   .catch(err => console.error(err));
}
module.exports = {
    login: async (req, res, next) => {
        try {
            const { login, senha } = req.body;
            if (!login || !senha) {
                throw new customError_1.CustomError('Email e senha são obrigatórios.', 400, '');
            }
            const isEmail = login.includes('@');
            let usuario;
            if (isEmail) {
                usuario = await Usuario_1.Usuario.findOne({ where: { email: login } });
            }
            else {
                usuario = await Usuario_1.Usuario.findOne({ where: { cpf: login } });
            }
            if (!usuario) {
                throw new customError_1.CustomError('Usuário não encontrado, Cadastre-se!', 404, '');
            }
            if (!usuario || !(await usuario.verifyPassword(senha))) {
                throw new customError_1.CustomError('Credenciais inválidas.', 401, '');
            }
            const token = (0, jwtUtils_1.generateToken)(usuario);
            usuario.token = token;
            usuario.save();
            res.status(200).json({
                data: token
            });
            // return res.status(200).json({ token });
        }
        catch (error) {
            next(error);
        }
    },
    addLogin: async (req, res, next) => {
        try {
            let { login, email, senha, nomeCompleto, cpf, telefone, id_cliente, sobreNome, endpoint, preCadastro } = req.body;
            if (preCadastro) {
                senha = cpf.replace(/\D/g, '').slice(-4); // Últimos 4 dígitos do CPF como senha
            }
            if (!login || !senha || !email || !nomeCompleto || !cpf || !sobreNome) {
                throw new customError_1.CustomError('Login, email e senha são obrigatórios.', 400, '');
            }
            let registro = await Usuario_1.Usuario.findOne({ where: { email } });
            if (registro) {
                throw new customError_1.CustomError('Este email já foi cadastrado, utilize recuperar senha.', 400, '');
            }
            registro = await Usuario_1.Usuario.findOne({ where: { cpf } });
            if (registro) {
                throw new customError_1.CustomError('Este cpf já tem cadastro no sistema .', 400, '');
            }
            registro = await Usuario_1.Usuario.findOne({ where: { login } });
            if (registro) {
                throw new customError_1.CustomError('Este login já foi utilizado por outro usuário .', 400, '');
            }
            let ativo = false;
            registro = await Usuario_1.Usuario.create({ login, email, senha, nomeCompleto, ativo, cpf, telefone, id_cliente, sobreNome, preCadastro });
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async enviarEmailRecuperacaoSenha(req, res) {
        const { email, endpoint } = req.body;
        const user = await Usuario_1.Usuario.findOne({ where: { email } });
        if (!user)
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        const token = (0, jwtUtils_1.generateToken)(user);
        user.token = token;
        await user.save();
        const linkRecuperacao = `${endpoint}redefinirsenha?token=${token}`;
        const htmlContent = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e0e0e0;border-radius:8px;padding:24px;background-color:#f9f9f9;">
        <h2 style="color:#2a9d8f;">Recuperação de Senha</h2>
        <p>Olá <strong>${user.nomeCompleto} ${user.sobreNome ? user.sobreNome : ""}</strong>,</p>
        <p>Você solicitou a recuperação de sua senha. Clique no botão abaixo para criar uma nova senha:</p>
        <div style="text-align:center;margin:30px 0;">
          <a href="${linkRecuperacao}" style="background-color:#2a9d8f;color:#fff;padding:12px 24px;text-decoration:none;border-radius:5px;font-weight:bold;">Redefinir Senha</a>
        </div>
        <p>Se você não solicitou essa recuperação, pode ignorar este e-mail.</p>
        <p>Atenciosamente,<br><strong>Jango Ingressos</strong></p>
        <small>Desenvolvido por Tanz Tecnologia Ltda</small>
      </div>
    `;
        try {
            const response = await resend_1.resend.emails.send({
                from: 'Jango Ingressos <no-reply@jangoingressos.com.br>',
                to: [user.email],
                subject: 'Recupere sua senha',
                html: htmlContent
            });
            if (response.error) {
                console.error('Erro ao enviar com Resend:', response.error);
                return res.status(500).json({ message: 'Erro ao enviar o e-mail.' });
            }
            return res.status(200).json({ message: 'E-mail de recuperação enviado com sucesso.' });
        }
        catch (error) {
            console.error('Erro geral no envio:', error);
            return res.status(500).json({ message: 'Erro ao enviar o e-mail.' });
        }
    },
    async varificaAtivarConta(req, res) {
        const { info, codigo, id } = req.body;
        if (!id) {
            throw new customError_1.CustomError('id é obrigatórios.', 400, '');
        }
        if (!info || !codigo) {
            throw new customError_1.CustomError('info e codigo são obrigatórios.', 400, '');
        }
        const storedCode = codeStore.get(info);
        if (storedCode === codigo) {
            const usuario = await Usuario_1.Usuario.findOne({ where: { id } });
            if (!usuario) {
                return res.status(404).json({ error: "Usuário não encontrado" });
            }
            usuario.ativo = true;
            codeStore.delete(info);
            usuario.save();
            return res.json({ success: true });
        }
        return res.status(400).json({ error: "Código inválido ou expirado" });
    },
    enviaCodigoAtivacao: async (req, res, next) => {
        const { info, tipo } = req.body;
        if (!info) {
            throw new customError_1.CustomError(`${tipo} é obrigatórios.`, 400, '');
        }
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        if (tipo === 'email') {
            try {
                await enviaCodigoEmail(info, code);
                codeStore.set(info, code);
                setTimeout(() => codeStore.delete(info), 15 * 60 * 1000); // Expira em 15 minutos
                res.json({ success: true });
            }
            catch (error) {
                console.error("Erro ao enviar código:", error);
                res.status(500).json({ error: "Erro ao enviar código" });
            }
        }
        else if (tipo === 'sms' || tipo === 'whatsapp') {
            try {
                if (tipo === 'whatsapp') {
                    // await sendCodeWhatsApp(formatPhoneToE164(info), code);
                    // await enviarCodigoAtivacaoChatPro(formatPhoneToE164(info), code)
                    codeStore.set(info, code);
                    setTimeout(() => codeStore.delete(info), 15 * 60 * 1000); // Expira em 15 minutos
                    res.json({ success: true, code });
                    return;
                }
                if (tipo === 'sms') {
                    console.log('info', formatPhoneToE164(info));
                    console.log('code', code);
                    await (0, twilioService_1.sendCodeSMS)(formatPhoneToE164(info), code);
                }
                res.json({ success: true });
            }
            catch (error) {
                return res.status(500).json({ error: 'Erro ao enviar código', details: error.message });
            }
        }
    },
    visitasNoSite: async (req, res) => {
        let visitas = await Visitas_1.Visitas.findByPk(1);
        if (!visitas) {
            const novaVisita = await Visitas_1.Visitas.create({ quantidade: 1 });
            visitas = novaVisita;
        }
        if (visitas) {
            visitas.quantidade += 1;
            await visitas.save();
        }
        return res.json({ success: true, visitasNoSite: visitas ? visitas.quantidade : 1 });
    }
};
