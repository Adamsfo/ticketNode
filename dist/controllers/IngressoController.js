"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addIngressoTransacao = void 0;
const getRegistros_1 = require("../utils/getRegistros");
const customError_1 = require("../utils/customError");
const Ingresso_1 = require("../models/Ingresso");
const EventoIngresso_1 = require("../models/EventoIngresso");
const Transacao_1 = require("../models/Transacao");
const Evento_1 = require("../models/Evento");
const qrcode_1 = __importDefault(require("qrcode"));
const TipoIngresso_1 = require("../models/TipoIngresso");
const uuid_1 = require("uuid");
const Usuario_1 = require("../models/Usuario");
const date_fns_tz_1 = require("date-fns-tz");
const apiJango_1 = __importDefault(require("../api/apiJango"));
const addIngressoTransacao = async (idTransacao, idIngresso, preco, taxaServico, valorTotal) => {
    try {
        await Transacao_1.IngressoTransacao.create({ idTransacao, idIngresso, preco, taxaServico, valorTotal });
    }
    catch (error) {
        console.error('Erro ao adicionar ingresso à transação:', error);
    }
};
exports.addIngressoTransacao = addIngressoTransacao;
const addHistorico = async (idIngresso, idUsuario, descricao) => {
    try {
        const data = new Date(); // Data atual
        await Ingresso_1.HistoricoIngresso.create({ idIngresso, idUsuario, data, descricao });
    }
    catch (error) {
        console.error('Erro ao adicionar histórico:', error);
    }
};
async function aguardarContaCriada(idCliente, tentativas = 5, intervaloMs = 1000) {
    for (let i = 0; i < tentativas; i++) {
        const contas = await (0, apiJango_1.default)().getConta(idCliente, true);
        if (contas.length > 0)
            return contas;
        await new Promise(res => setTimeout(res, intervaloMs));
    }
    throw new Error('Conta não foi criada após múltiplas tentativas.');
}
module.exports = {
    async get(req, res, next) {
        try {
            const result = await (0, getRegistros_1.getRegistros)(Ingresso_1.Ingresso, req, res, next, [
                {
                    model: Evento_1.Evento,
                    as: 'Evento',
                    attributes: ['nome', 'imagem', 'data_hora_inicio', 'endereco'],
                },
                {
                    model: EventoIngresso_1.EventoIngresso,
                    as: 'EventoIngresso',
                    attributes: ['nome'],
                },
                {
                    model: TipoIngresso_1.TipoIngresso,
                    as: 'TipoIngresso',
                    attributes: ['descricao'],
                },
                {
                    model: Usuario_1.Usuario,
                    as: 'Usuario',
                    attributes: ['nomeCompleto', 'cpf', 'email'],
                },
            ], true);
            const { data, meta } = result ?? { data: [], meta: { totalItems: 0, totalPages: 0, currentPage: 0, pageSize: 0 } };
            const dataComQrCode = await Promise.all(data.map(async (registro) => {
                const payload = {
                    idqrcode: registro.qrcode,
                };
                const qrCodeBase64 = await qrcode_1.default.toDataURL(JSON.stringify(payload));
                return {
                    ...registro,
                    qrCodeBase64
                };
            }));
            res.status(200).json({
                data: dataComQrCode,
                meta
            });
        }
        catch (err) {
            next(err);
        }
    },
    async add(req, res, next) {
        try {
            let { idEvento, idEventoIngresso, idTipoIngresso, idUsuario, idTransacao, tipo, idUsuarioCriouIngresso, status } = req.body;
            console.log('Adicionando ingresso:', req.body);
            if (!status) {
                status = 'Reservado';
            }
            //   // Validação básica
            if (!idEvento || !idEventoIngresso || !idTipoIngresso || !idUsuario) {
                throw new customError_1.CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }
            const dataValidade = new Date(); // Data atual
            const dataNascimento = new Date(); // Data atual
            const eventoIngresso = await EventoIngresso_1.EventoIngresso.findByPk(idEventoIngresso);
            if (eventoIngresso?.nome.includes('Antecipado')) {
                dataValidade.setDate(dataValidade.getDate() + 1);
            }
            if (!tipo) {
                tipo = Ingresso_1.TipoVendidoCortesia.Vendido;
            }
            if (!idUsuarioCriouIngresso) {
                idUsuarioCriouIngresso = idUsuario; // Se não for fornecido, usa
            }
            const registro = await Ingresso_1.Ingresso.create({ ...req.body, status, dataValidade, dataNascimento, tipo });
            // const qrData = `qrcode:${registro.qrcode}`
            // const qrCodeBase64 = await QRCode.toDataURL(qrData);
            // Adiciona o histórico após a criação do ingresso
            await addHistorico(registro.id, idUsuario, 'Ingresso criado com sucesso.');
            if (!eventoIngresso) {
                throw new customError_1.CustomError('EventoIngresso não encontrado.', 404, '');
            }
            if (idTransacao) {
                await (0, exports.addIngressoTransacao)(idTransacao, registro.id, eventoIngresso.preco, eventoIngresso.taxaServico, eventoIngresso.valor);
                // Adiciona o histórico após a criação do ingresso
                await addHistorico(registro.id, idUsuario, 'Vinculado a transação ' + idTransacao);
            }
            return res.status(201).json(registro);
        }
        catch (error) {
            next(error);
        }
    },
    async edit(req, res, next) {
        try {
            const id = req.params.id;
            const registro = await Ingresso_1.Ingresso.findByPk(id);
            if (!registro) {
                throw new customError_1.CustomError('Registro não encontrado.', 404, '');
            }
            // Atualizar apenas os campos que estão definidos (não são undefined)
            Object.keys(req.body).forEach(field => {
                if (req.body[field] !== undefined && field in registro) {
                    registro[field] = req.body[field];
                }
            });
            await registro.save();
            return res.status(200).json(registro);
        }
        catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },
    async editNomeImpresso(req, res, next) {
        try {
            const id = req.params.id;
            const registro = await Ingresso_1.Ingresso.findByPk(id);
            if (!registro) {
                throw new customError_1.CustomError('Registro não encontrado.', 404, '');
            }
            const { nomeImpresso } = req.body;
            if (!nomeImpresso) {
                throw new customError_1.CustomError('Nome impresso é obrigatório.', 400, '');
            }
            registro.nomeImpresso = nomeImpresso;
            await registro.save();
            return res.status(200).json(registro);
        }
        catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },
    async delete(req, res, next) {
        try {
            const id = req.params.id;
            if (!id) {
                throw new customError_1.CustomError('ID do registro é obrigatório.', 400, '');
            }
            // Verificar se o usuário existe
            const registro = await Ingresso_1.Ingresso.findByPk(id);
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
    async atribuirOutroUsuario(req, res, next) {
        try {
            const id = req.params.id;
            const { idUsuarioNovo, NomeUsuarioNovo, idUsuario } = req.body;
            const registro = await Ingresso_1.Ingresso.findByPk(id);
            if (!registro) {
                throw new customError_1.CustomError('Registro não encontrado.', 404, '');
            }
            if (!idUsuarioNovo) {
                throw new customError_1.CustomError('Nome é obrigatório.', 400, '');
            }
            registro.idUsuario = idUsuarioNovo;
            registro.qrcode = (0, uuid_1.v4)(); // Limpa o QRCode ao atribuir a outro usuário
            registro.atribuirOutroUsuario = true; // Marca como atribuído a outro usuário
            await addHistorico(registro.id, idUsuario, 'Ingresso atribuído a ' + NomeUsuarioNovo);
            await registro.save();
            return res.status(200).json(registro);
        }
        catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },
    async validadorJango(req, res, next) {
        try {
            const { ingressos, idUsuario } = req.body;
            console.log('Validador Jango - Ingressos:asdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfa');
            // Verifica se o array de ingressos está vazio
            if (!ingressos || ingressos.length === 0) {
                throw new customError_1.CustomError('Nenhum ingresso marcado para abrir conta!', 400, '');
            }
            // Verifica se o array de ingressos contém objetos
            if (!Array.isArray(ingressos) || !ingressos.every(item => typeof item === 'number')) {
                throw new customError_1.CustomError('Formato inválido para o array de ingressos.', 400, '');
            }
            // Verifica se o array de ingressos contém IDs válidos
            const idsValidos = ingressos.filter(id => typeof id === 'number' && id > 0);
            if (idsValidos.length === 0) {
                throw new customError_1.CustomError('Nenhum ID de ingresso válido encontrado.', 400, '');
            }
            // Verifica se o array de ingressos contém IDs duplicados
            const idsDuplicados = ingressos.filter((item, index) => ingressos.indexOf(item) !== index);
            if (idsDuplicados.length > 0) {
                throw new customError_1.CustomError('IDs duplicados encontrados: ' + idsDuplicados.join(', '), 400, '');
            }
            // Verifica se os ingressos existem no banco de dados
            const ingressosExistentes = await Ingresso_1.Ingresso.findAll({
                where: {
                    id: idsValidos,
                },
            });
            if (ingressosExistentes.length !== idsValidos.length) {
                const idsNaoEncontrados = idsValidos.filter(id => !ingressosExistentes.some(ingresso => ingresso.id === id));
                throw new customError_1.CustomError('Ingressos não encontrados: ' + idsNaoEncontrados.join(', '), 404, '');
            }
            // Verifica se os ingressos estão disponíveis
            const ingressosIndisponiveis = ingressosExistentes.filter(ingresso => ingresso.status !== 'Confirmado');
            if (ingressosIndisponiveis.length > 0) {
                const idsIndisponiveis = ingressosIndisponiveis.map(ingresso => ingresso.id);
                throw new customError_1.CustomError('Ingressos não disponíveis: ' + idsIndisponiveis.join(', '), 400, '');
            }
            const user = await Usuario_1.Usuario.findByPk(idUsuario);
            if (!user) {
                throw new customError_1.CustomError('Usuário validador não encontrado.', 404, '');
            }
            //Pegar idCliente Jango no usuário do ingresso
            const userIngresso = await Usuario_1.Usuario.findByPk(ingressosExistentes[0].idUsuario);
            if (!userIngresso) {
                throw new customError_1.CustomError('Usuário ingresso não encontrado.', 404, '');
            }
            if (!userIngresso.id_cliente || Number(userIngresso.id_cliente) === 0) {
                if (userIngresso.cpf) {
                    console.log('CPF do usuário do ingresso:', userIngresso.cpf);
                    const dadosJango = await (0, apiJango_1.default)().getCliente(userIngresso.cpf.toString());
                    const clienteJango = dadosJango[0];
                    console.log('Cliente Jango:', clienteJango);
                    if (clienteJango.error) {
                        throw new customError_1.CustomError(clienteJango.error, 400, '');
                    }
                    if (!clienteJango.id_cliente || Number(clienteJango.id_cliente) === 0) {
                        throw new customError_1.CustomError('Cliente Jango retornou ID inválido.', 400, '');
                    }
                    userIngresso.id_cliente = clienteJango.id_cliente;
                    await userIngresso.save();
                    await userIngresso.reload(); // <-- importante
                }
                else {
                    throw new customError_1.CustomError('CPF do usuário do ingresso não encontrado.', 400, '');
                }
            }
            if (!userIngresso.id_cliente || Number(userIngresso.id_cliente) === 0) {
                throw new customError_1.CustomError('Usuário não possui um id_cliente válido no Jango.', 400, '');
            }
            console.log('ID Cliente Jango:', userIngresso);
            // Localizar conta no Jango Aberta
            let contaJango = await (0, apiJango_1.default)().getConta(userIngresso.id_cliente, true);
            //Abre Conta no Jango
            if (contaJango.length === 0) {
                await (0, apiJango_1.default)().abreConta(userIngresso.id_cliente);
                contaJango = await aguardarContaCriada(userIngresso.id_cliente);
            }
            // Localizar conta no Jango Aberta
            contaJango = await (0, apiJango_1.default)().getConta(userIngresso.id_cliente, true);
            if (contaJango.length > 0) {
                for (const ingresso of ingressosExistentes) {
                    // Atualizar o ingresso no Jango
                    const eventoIngresso = await EventoIngresso_1.EventoIngresso.findByPk(ingresso.idEventoIngresso);
                    await (0, apiJango_1.default)().inseriIngresso(ingresso.id, eventoIngresso?.nome ?? '', userIngresso.id_cliente, contaJango[0].id_venda);
                    await addHistorico(ingresso.id, idUsuario, 'Ingresso Inserido no Sistema do Jango ');
                }
            }
            const dataUtilizado = new Date(); // Data atual
            for (const ingresso of ingressosExistentes) {
                ingresso.status = 'Utilizado';
                ingresso.dataUtilizado = dataUtilizado;
                await ingresso.save();
                await addHistorico(ingresso.id, idUsuario, 'Ingresso Utilizado ' +
                    (0, date_fns_tz_1.formatInTimeZone)(dataUtilizado, "America/Cuiaba", "dd/MM/yyyy HH:mm") +
                    ' validado por ' + user.nomeCompleto);
            }
            return res.status(200).json('Ingressos validados com sucesso!');
        }
        catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },
};
