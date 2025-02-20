import { Usuario } from '../models/Usuario'
import { generateToken } from '../utils/jwtUtils'
import { CustomError } from '../utils/customError'

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
        usuario = await Usuario.findOne({ where: { login } });
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
      const { login, email, senha, nomeCompleto } = req.body;

      if (!login || !senha || !email) {
        throw new CustomError('Login, email e senha são obrigatórios.', 400, '');
      }

      let registro = await Usuario.findOne({ where: { email } })
      if (registro) {
        throw new CustomError('Este email já foi cadastrado, utilize recuperar senha.', 400, '');
      }

      registro = await Usuario.findOne({ where: { login } })
      if (registro) {
        throw new CustomError('Este login já foi utilizado por outro usuário .', 400, '');
      }

      let ativo = false

      registro = await Usuario.create({ login, email, senha, nomeCompleto, ativo });

      return res.status(201).json(registro);
    } catch (error) {
      next(error);
    }
  },
}
