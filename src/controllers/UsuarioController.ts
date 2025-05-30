import { FuncaoSistema, FuncaoUsuario, FuncaoUsuarioAcesso, Usuario, UsuarioEmpresa } from '../models/Usuario'
import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { Empresa } from '../models/Empresa'

module.exports = {
  async getUsuario(req: any, res: any, next: any) {
    await getRegistros(Usuario, req, res, next, [
      {
        model: FuncaoUsuario,
        as: 'funcaoUsuario',
        attributes: ['funcaoUsuario'],
      }
    ])
  },

  async addUsuario(req: any, res: any, next: any) {
    try {
      const { email, login, senha, nomeCompleto, idFuncaoUsuario, ativo, alterarSenha } = req.body;

      // Validação básica
      if (!email || !login || !senha || !nomeCompleto) {
        // return res.status(400).json({ message: 'Os campos email, login, senha, nomeCompleto são obrigatórios.' });
        throw new CustomError('Os campos email, login, senha, nomeCompleto são obrigatórios.', 400, '');
      }

      const registro = await Usuario.create({ email, login, senha, nomeCompleto, ativo, alterarSenha, idFuncaoUsuario });
      console.log(registro)
      return res.status(201).json(registro);
    } catch (error) {
      next(error);
    }
  },

  async editUsuario(req: any, res: any, next: any) {
    try {
      const id = req.params.id;
      const { email, login, nomeCompleto, ativo, alterarSenha, idFuncaoUsuario, senha, telefone, sobreNome } = req.body;

      // Validação dos dados (exemplo simples)
      if (!id) {
        throw new CustomError('ID do usuário é obrigatório.', 400, '');
      }

      if (!email && !login && !nomeCompleto && ativo === undefined && alterarSenha === undefined) {
        // return res.status(400).json({ message: 'Nenhum campo para atualizar fornecido.' });
        throw new CustomError('Nenhum campo para atualizar fornecido.', 400, '');
      }

      // Verificar se o usuário existe
      const registro = await Usuario.findByPk(id);
      if (!registro) {
        throw new CustomError('Usuário não encontrado.', 404, '');
        // return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      // Atualizar os campos permitidos
      if (email) registro.email = email;
      if (login) registro.login = login;
      if (senha) registro.senha = senha;
      if (nomeCompleto) registro.nomeCompleto = nomeCompleto;
      if (sobreNome) registro.sobreNome = sobreNome;
      if (idFuncaoUsuario) registro.idFuncaoUsuario = idFuncaoUsuario;
      if (ativo !== undefined) registro.ativo = ativo;
      if (alterarSenha !== undefined) registro.alterarSenha = alterarSenha;
      if (telefone) registro.telefone = telefone;

      await registro.save();
      return res.status(200).json(registro);
    } catch (error) {
      next(error); // Passa o erro para o middleware de tratamento de erros
    }
  },

  async deleteUsuario(req: any, res: any, next: any) {
    try {
      const id = req.params.id;

      if (!id) {
        throw new CustomError('ID do usuário é obrigatório.', 400, '');
        // return res.status(400).json({ message: 'ID do usuário é obrigatório.' });
      }

      // Verificar se o usuário existe
      const registro = await Usuario.findByPk(id);
      if (!registro) {
        throw new CustomError('Usuário não encontrado.', 404, '');
        // return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      // Deletar o usuário
      await registro.destroy();

      return res.status(200).json({ message: 'Usuário deletado com sucesso.' });
    } catch (error) {
      next(error); // Passa o erro para o middleware de tratamento de erros
    }
  },

  async getFuncaoUsuario(req: any, res: any, next: any) {
    await getRegistros(FuncaoUsuario, req, res, next)
  },

  async addFuncaoUsuario(req: any, res: any, next: any) {
    try {
      const { funcaoUsuario } = req.body;

      //   // Validação básica
      if (!funcaoUsuario) {
        throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
      }

      const registro = await FuncaoUsuario.create({ funcaoUsuario });
      return res.status(201).json(registro);
    } catch (error) {
      next(error);
    }
  },

  async editFuncaoUsuario(req: any, res: any, next: any) {
    try {
      const id = req.params.id;
      const { funcaoUsuario } = req.body;

      const registro = await FuncaoUsuario.findByPk(id);
      if (!registro) {
        throw new CustomError('Registro não encontrado.', 404, '');
      }

      // Atualizar os campos permitidos
      if (funcaoUsuario) registro.funcaoUsuario = funcaoUsuario;

      await registro.save();
      return res.status(200).json(registro);
    } catch (error) {
      next(error); // Passa o erro para o middleware de tratamento de erros
    }
  },

  async deleteFuncaoUsuario(req: any, res: any, next: any) {
    try {
      const id = req.params.id;

      if (!id) {
        throw new CustomError('ID do registro é obrigatório.', 400, '');
      }

      // Verificar se o usuário existe
      const registro = await FuncaoUsuario.findByPk(id);
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

  async getFuncaoUsuarioAcesso(req: any, res: any, next: any) {
    await getRegistros(FuncaoUsuarioAcesso, req, res, next, [
      {
        model: FuncaoSistema,
        as: 'funcaoSistema',
        attributes: ['funcaoSistema']
      },
      {
        model: FuncaoUsuario,
        as: 'funcaoUsuario',
        attributes: ['funcaoUsuario']
      }
    ])
  },

  async addFuncaoUsuarioAcesso(req: any, res: any, next: any) {
    try {
      const { idFuncaoSistema, idFuncaoUsuario } = req.body;

      //   // Validação básica
      if (!idFuncaoSistema || !idFuncaoUsuario) {
        throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
      }

      const registro = await FuncaoUsuarioAcesso.create({ idFuncaoSistema, idFuncaoUsuario });
      return res.status(201).json(registro);
    } catch (error) {
      next(error);
    }
  },

  async deleteFuncaoUsuarioAcesso(req: any, res: any, next: any) {
    try {
      const id = req.params.id;

      if (!id) {
        throw new CustomError('ID do registro é obrigatório.', 400, '');
      }

      // Verificar se o usuário existe
      const registro = await FuncaoUsuarioAcesso.findByPk(id);
      if (!registro) {
        throw new CustomError('Registro não encontrado.', 404, '');
      }

      await registro.destroy();

      return res.status(200).json({ message: 'Registro deletado com sucesso.' });
    } catch (error) {
      next(error);
    }
  },

  async getFuncaoSistema(req: any, res: any, next: any) {
    await getRegistros(FuncaoSistema, req, res, next)
  },

  async getUsuarioEmpresa(req: any, res: any, next: any) {
    await getRegistros(UsuarioEmpresa, req, res, next, [
      {
        model: Empresa,
        as: 'empresa',
        attributes: ['nomeFantasia']
      }
    ])
  },

  async addUsuarioEmpresa(req: any, res: any, next: any) {
    try {
      const { usuarioId, empresaId } = req.body;

      //   // Validação básica
      if (!usuarioId || !empresaId) {
        throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
      }

      const registro = await UsuarioEmpresa.create({ usuarioId, empresaId });
      return res.status(201).json(registro);
    } catch (error) {
      next(error);
    }
  },

  async deleteUsuarioEmpresa(req: any, res: any, next: any) {
    try {
      const id = req.params.id;

      if (!id) {
        throw new CustomError('ID do registro é obrigatório.', 400, '');
      }

      // Verificar se o usuário existe
      const registro = await UsuarioEmpresa.findByPk(id);
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
}