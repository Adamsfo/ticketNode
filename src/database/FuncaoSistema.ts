import { FuncaoSistema, FuncaoUsuario, FuncaoUsuarioAcesso } from '../models/Usuario'

module.exports = {
    funcaoSistema: async () => {

        await FuncaoSistema.findOrCreate({
            where: {
                id: 1,
                funcaoSistema: "Cadastro / Cliente - Listagem"
            }
        })

        await FuncaoSistema.findOrCreate({
            where: {
                id: 2,
                funcaoSistema: "Cadastro / Cliente - Cadastro e Alteração"
            }
        })

        await FuncaoSistema.findOrCreate({
            where: {
                id: 3,
                funcaoSistema: "Cadastro / Fornecedor  - Listagem"
            }
        })

        await FuncaoSistema.findOrCreate({
            where: {
                id: 4,
                funcaoSistema: "Cadastro / Fornecedor - Cadastro e Alteração"
            }
        })

        await FuncaoSistema.findOrCreate({
            where: {
                id: 5,
                funcaoSistema: "Cadastro / Cidade  - Listagem"
            }
        })

        await FuncaoSistema.findOrCreate({
            where: {
                id: 6,
                funcaoSistema: "Cadastro / Cidade - Cadastro e Alteração"
            }
        })

        await FuncaoSistema.findOrCreate({
            where: {
                id: 7,
                funcaoSistema: "Config. de Sistema / Função de Usuário - Listagem"
            }
        })

        await FuncaoSistema.findOrCreate({
            where: {
                id: 8,
                funcaoSistema: "Config. de Sistema / Função de Usuário - Cadastro e Alteração"
            }
        })

        await FuncaoSistema.findOrCreate({
            where: {
                id: 9,
                funcaoSistema: "Config.de Sistema / Usuário do Sistema  - Listagem"
            }
        })

        await FuncaoSistema.findOrCreate({
            where: {
                id: 10,
                funcaoSistema: "Config.de Sistema / Usuário do Sistema - Cadastro e Alteração"
            }
        })

        const funcaoUsuario = await FuncaoUsuario.findOrCreate({
            where: {
                funcaoUsuario: "Administrador"
            }
        })

        // Inserindo essas permisões para usuario Administrador
        const funcoesSistema = [7, 8, 9, 10];

        for (const idFuncaoSistema of funcoesSistema) {
            await FuncaoUsuarioAcesso.findOrCreate({
                where: {
                    idFuncaoSistema: idFuncaoSistema,
                    idFuncaoUsuario: funcaoUsuario[0].id
                }
            });
        }

    }
}