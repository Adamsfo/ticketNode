import apiJango from '../api/apiJango';
import { CustomError } from '../utils/customError'

module.exports = {
    async getCliente(req: any, res: any, next: any) {
        try {
            const cpf = req.body.cpf;
            console.log(req.query)
            if (!cpf) {
                throw new CustomError('CPF é obrigatório.', 400, '');
            }

            const dadosJango = await apiJango().getCliente(cpf);

            if (!dadosJango[0]) {
                throw new CustomError('Cliente não encontrado.', 404, '');
            }

            // const registro = {
            //     id: dadosJango[0].ID,
            //     cpf: dadosJango[0].CPF_CNPJ,
            //     nomeCompleto: dadosJango[0].NOME,
            //     telefone: dadosJango[0].TELEFONE_CELULAR,
            //     email: dadosJango[0].EMAIL,
            // };

            console.log("Registro retornado:", dadosJango[0]);

            return res.status(200).json(dadosJango[0]);
        } catch (error) {
            next(error);
        }
    },

    async addCliente(req: any, res: any, next: any) {
        try {
            const { cpf, nomeCompleto, sobreNome, telefone, email } = req.body;

            // Validação básica
            if (!cpf || !nomeCompleto || !sobreNome || !telefone) {
                throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }

            await apiJango().atualizarCliente({
                CPF_CNPJ: (cpf ?? "").replace(/\D/g, ""),
                NOME: nomeCompleto + " " + sobreNome,
                TELEFONE_CELULAR: (telefone ?? "").replace(/\D/g, ""),
                EMAIL: email ? email : "",
            });

            await new Promise((resolve) => setTimeout(resolve, 1000));
            const dadosJango = await apiJango().getCliente(cpf);
            if (!dadosJango[0]) {
                throw new CustomError('Cliente não encontrado após atualização.', 404, '');
            }
            return res.status(201).json(dadosJango[0]);

        } catch (error) {
            next(error);
        }
    },

    async getPedidosUsuario(req: any, res: any, next: any) {
        try {
            const { dataInicio, dataFim } = req.query;
            console.log("Parâmetros recebidos:", { dataInicio, dataFim });

            if (!dataInicio || !dataFim) {
                throw new CustomError('Data de início e fim são obrigatórias.', 400, '');
            }

            const dadosJango = await apiJango().consultaPedidosPorUsuario(dataInicio, dataFim);
            console.log("Pedidos retornados:", dadosJango);
            // return res.status(200).json(dadosJango);
            return res.status(200).json({ data: dadosJango, meta: { totalItems: 0, totalPages: 0, currentPage: 0, pageSize: 0 } });

        } catch (error) {
            next(error);
        }
    },
}
