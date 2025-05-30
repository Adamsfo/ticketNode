import { Usuario } from '../models/Usuario'
import { generateToken } from '../utils/jwtUtils'
import { CustomError } from '../utils/customError'
import nodemailer from 'nodemailer'
import { sendCodeSMS, sendCodeWhatsApp } from '../utils/twilioService'

const codeStore = new Map<string, string>()

function formatPhoneToE164(phone: string): string {
  // Remove caracteres não numéricos
  const cleaned = phone.replace(/\D/g, '');
  // Adiciona o código do país se não estiver presente
  return cleaned.startsWith('55') ? `+${cleaned}` : `+55${cleaned}`;
}

const enviaCodigoEmail = async (email: string, codigo: string) => {
  try {

    if (!email) {
      throw new CustomError('Email é obrigatórios.', 400, '');
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail', // ou SMTP personalizado
      auth: {
        user: 'tanztecnologialtda@gmail.com',
        pass: 'tmre buon mfhc mfgg'
      }
    });

    try {
      await transporter.sendMail({
        from: 'Tanz Tecnologia Ltda <tanztecnologialtda@gmail.com>',
        to: email,
        subject: "Seu código de verificação Jango Ingressos",
        text: `Seu código de verificação é: ${codigo}`,
        html: `<h2>Seu código de verificação é:</h2><h1>${codigo}</h1>`,
      });

    } catch (error) {
      console.error('Erro ao enviar e-mail:', error);
    }
  } catch (error) {
  }
}


module.exports = {
  login: async (req: any, res: any, next: any) => {
    try {
      const { login, senha } = req.body;

      if (!login || !senha) {
        throw new CustomError('Email e senha são obrigatórios.', 400, '');
      }

      const isEmail = login.includes('@')

      let usuario: Usuario | null
      if (isEmail) {
        usuario = await Usuario.findOne({ where: { email: login } });
      } else {
        usuario = await Usuario.findOne({ where: { cpf: login } });
      }

      if (!usuario) {
        throw new CustomError('Usuário não encontrado, Cadastre-se!', 404, '');
      }

      if (!usuario || !(await usuario.verifyPassword(senha))) {
        throw new CustomError('Credenciais inválidas.', 401, '');
      }

      const token = generateToken(usuario);
      usuario.token = token
      usuario.save()
      res.status(200).json({
        data: token
      });

      // return res.status(200).json({ token });
    } catch (error) {
      next(error);
    }
  },

  addLogin: async (req: any, res: any, next: any) => {
    try {
      const { login, email, senha, nomeCompleto, cpf, telefone, id_cliente, sobreNome, endpoint } = req.body;

      if (!login || !senha || !email || !nomeCompleto || !cpf || !sobreNome) {
        throw new CustomError('Login, email e senha são obrigatórios.', 400, '');
      }

      let registro = await Usuario.findOne({ where: { email } })
      if (registro) {
        throw new CustomError('Este email já foi cadastrado, utilize recuperar senha.', 400, '');
      }

      registro = await Usuario.findOne({ where: { cpf } })
      if (registro) {
        throw new CustomError('Este cpf já tem cadastro no sistema .', 400, '');
      }

      registro = await Usuario.findOne({ where: { login } })
      if (registro) {
        throw new CustomError('Este login já foi utilizado por outro usuário .', 400, '');
      }

      let ativo = false

      registro = await Usuario.create({ login, email, senha, nomeCompleto, ativo, cpf, telefone, id_cliente });

      return res.status(201).json(registro);
    } catch (error) {
      next(error);
    }
  },

  async enviarEmailRecuperacaoSenha(req: any, res: any) {
    const { email, endpoint } = req.body;

    const user = await Usuario.findOne({
      where: {
        email: email
      }
    });

    if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });

    const token = generateToken(user);
    user.token = token
    user.save()
    const linkRecuperacao = `${endpoint}redefinirsenha?token=${token}`;

    const transporter = nodemailer.createTransport({
      service: 'gmail', // ou SMTP personalizado
      auth: {
        user: 'tanztecnologialtda@gmail.com',
        pass: 'tmre buon mfhc mfgg'
      }
    });

    const htmlContent = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e0e0e0;border-radius:8px;padding:24px;background-color:#f9f9f9;">
        <h2 style="color:#2a9d8f;">Recuperação de Senha</h2>
        <p>Olá <strong>${user.nomeCompleto + ' ' + user.sobreNome}</strong>,</p>
        <p>Você solicitou a recuperação de sua senha. Clique no botão abaixo para criar uma nova senha:</p>
        <div style="text-align:center;margin:30px 0;">
          <a href="${linkRecuperacao}" style="background-color:#2a9d8f;color:#fff;padding:12px 24px;text-decoration:none;border-radius:5px;font-weight:bold;">Redefinir Senha</a>
        </div>
        <p>Se você não solicitou essa recuperação, pode ignorar este e-mail.</p>
        <p>Atenciosamente,<br><strong>Tanz Tecnologia Ltda</strong></p>
      </div>
    `;

    try {
      await transporter.sendMail({
        from: 'Tanz Tecnologia Ltda <tanztecnologialtda@gmail.com>',
        to: user.email,
        subject: 'Recupere sua senha',
        html: htmlContent
      });

      res.status(200).json({ message: 'E-mail de recuperação enviado com sucesso.' });
    } catch (error) {
      console.error('Erro ao enviar e-mail:', error);
      res.status(500).json({ message: 'Erro ao enviar o e-mail.' });
    }
  },

  async varificaAtivarConta(req: any, res: any) {
    const { info, codigo, id } = req.body;

    if (!id) {
      throw new CustomError('id é obrigatórios.', 400, '');
    }

    if (!info || !codigo) {
      throw new CustomError('info e codigo são obrigatórios.', 400, '');
    }

    const storedCode = codeStore.get(info);

    if (storedCode === codigo) {
      const usuario = await Usuario.findOne({ where: { id } });
      if (!usuario) {
        return res.status(404).json({ error: "Usuário não encontrado" });
      }
      usuario.ativo = true;
      codeStore.delete(info);
      usuario.save()
      return res.json({ success: true });
    }

    return res.status(400).json({ error: "Código inválido ou expirado" });
  },

  enviaCodigoAtivacao: async (req: any, res: any, next: any) => {
    const { info, tipo } = req.body;

    if (!info) {
      throw new CustomError(`${tipo} é obrigatórios.`, 400, '');
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString()

    if (tipo === 'email') {
      try {
        await enviaCodigoEmail(info, code);
        codeStore.set(info, code);
        setTimeout(() => codeStore.delete(info), 5 * 60 * 1000); // Expira em 5 minutos
        res.json({ success: true });
      } catch (error) {
        console.error("Erro ao enviar código:", error);
        res.status(500).json({ error: "Erro ao enviar código" });
      }
    } else if (tipo === 'sms' || tipo === 'whatsapp') {
      try {
        if (tipo === 'whatsapp') {
          await sendCodeWhatsApp(formatPhoneToE164(info), code);
        }
        if (tipo === 'sms') {
          console.log('info', formatPhoneToE164(info))
          console.log('code', code)
          await sendCodeSMS(formatPhoneToE164(info), code);
        }
        res.json({ success: true });
      } catch (error: any) {
        return res.status(500).json({ error: 'Erro ao enviar código', details: error.message });
      }
    }
  },
}
