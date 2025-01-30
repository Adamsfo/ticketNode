import { Empresa } from '../models/Empresa'
import { FuncaoSistema, FuncaoUsuario, FuncaoUsuarioAcesso, Usuario, UsuarioEmpresa } from '../models/Usuario'

module.exports = {
    configUsuario: async () => {
        const usuario = await Usuario.findOrCreate({
            where: {
                login: "Admin",
                email: "admin@tanztecnologia.com.br",
            },
            defaults: {
                login: "Admin",
                email: "admin@tanztecnologia.com.br",
                senha: "123456",
                ativo: true,
                alterarSenha: false,
                nomeCompleto: "Administrador Tanz",
                idFuncaoUsuario: 1
            }
        })

        const empresa = await Empresa.findOrCreate({
            where: {
                id: 1
            },
            defaults: {
                nomeFantasia: "Tanz Tecnologia",
                razaoSocial: "Tanz Tecnologia",
                cnpj: "12345678901234",
                inscricaoEstadual: "123456789012",
                inscricaoMunicipal: "123456789012",
                dataInicioAtividades: new Date(),
                cep: "12345678",
                endereco: "Rua Teste",
                numero: "123",
                complemento: "",
                bairro: "Bairro Teste",
                idCidade: 1100015,
                logradouro: "Rua Teste",
                telefone: "1234567890",
                regimeTributario: 'Simples Nacional',
                ambienteNFe: 'Homologação',
                tipo: 'principal'
            }
        })

        await UsuarioEmpresa.findOrCreate({
            where: {
                usuarioId: usuario[0].id,
                empresaId: empresa[0].id
            },
            defaults: {
                usuarioId: usuario[0].id,
                empresaId: empresa[0].id
            }
        })

        await Empresa.findOrCreate({
            where: {
                id: 2
            },
            defaults: {
                nomeFantasia: "Tanz Tecnologia2",
                razaoSocial: "Tanz Tecnologia2",
                cnpj: "12345678901232",
                inscricaoEstadual: "1234567890122",
                inscricaoMunicipal: "1234567890122",
                dataInicioAtividades: new Date(),
                cep: "12345678",
                endereco: "Rua Tes2te",
                numero: "1223",
                complemento: "2",
                bairro: "Bairro Te2ste",
                idCidade: 1100015,
                logradouro: "Rua Te2ste",
                telefone: "12345678290",
                regimeTributario: 'Simples Nacional',
                ambienteNFe: 'Homologação',
                tipo: 'principal'
            }
        })
    }
}