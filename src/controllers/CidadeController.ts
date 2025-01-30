import { Cidade } from "../models/Cidade"
import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'

module.exports = {
  async getCidade(req: any, res: any, next: any) {
    await getRegistros(Cidade, req, res, next)
  },

  async addCidade(req: any, res: any, next: any) {
    try {
      const { descricao, uf } = req.body;

      // Validação básica
      if (!descricao || !uf) {
        throw new CustomError('Os campos email, login, senha, nomeCompleto são obrigatórios.', 400, '');
      }

      const registro = await Cidade.create({ descricao, uf });
      return res.status(201).json(registro);
    } catch (error) {
      next(error);
    }
  },

  async editCidade(req: any, res: any, next: any) {
    try {
      const id = req.params.id;
      const { descricao, uf } = req.body;

      // Validação dos dados (exemplo simples)
      if (!id) {
        throw new CustomError('ID da cidade é obrigatório.', 400, '');
      }

      if (!descricao && !uf) {
        // return res.status(400).json({ message: 'Nenhum campo para atualizar fornecido.' });
        throw new CustomError('Nenhum campo para atualizar fornecido.', 400, '');
      }

      // Verificar se o usuário existe
      const registro = await Cidade.findByPk(id);
      if (!registro) {
        throw new CustomError('Usuário não encontrado.', 404, '');
        // return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      // Atualizar os campos permitidos
      if (descricao) registro.descricao = descricao;
      if (uf) registro.uf = uf;

      await registro.save();
      return res.status(200).json(registro);
    } catch (error) {
      next(error); // Passa o erro para o middleware de tratamento de erros
    }
  },

  async deleteCidade(req: any, res: any, next: any) {
    try {
      const id = req.params.id;

      if (!id) {
        throw new CustomError('ID é obrigatório.', 400, '');
        // return res.status(400).json({ message: 'ID do usuário é obrigatório.' });
      }

      // Verificar se o usuário existe
      const registro = await Cidade.findByPk(id);
      if (!registro) {
        throw new CustomError('Registro não encontrado.', 404, '');
        // return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      // Deletar o usuário
      await registro.destroy();

      return res.status(200).json({ message: 'Regsitro deletado com sucesso.' });
    } catch (error) {
      next(error); // Passa o erro para o middleware de tratamento de erros
    }
  }
}