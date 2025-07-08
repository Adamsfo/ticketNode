import { getRegistros } from "../utils/getRegistros"
import { CustomError } from '../utils/customError'
import { HistoricoIngresso, Ingresso, TipoVendidoCortesia } from "../models/Ingresso";
import { EventoIngresso } from "../models/EventoIngresso";
import { IngressoTransacao } from "../models/Transacao";
import { Evento } from "../models/Evento";
import QRCode from 'qrcode';
import { TipoIngresso } from "../models/TipoIngresso";
import { v4 as uuidv4 } from 'uuid'
import { parseISO } from "date-fns";
import { Usuario } from "../models/Usuario";
import { formatInTimeZone } from "date-fns-tz";
import apiJango from "../api/apiJango";
import { col, fn, Op } from "sequelize";

export const addIngressoTransacao = async (idTransacao: number, idIngresso: number, preco: number, taxaServico: number, valorTotal: number) => {
    try {
        await IngressoTransacao.create({ idTransacao, idIngresso, preco, taxaServico, valorTotal });
    } catch (error) {
        console.error('Erro ao adicionar ingresso à transação:', error);
    }
}

const addHistorico = async (idIngresso: number, idUsuario: number, descricao: string) => {
    try {
        const data = new Date(); // Data atual
        await HistoricoIngresso.create({ idIngresso, idUsuario, data, descricao });
    }
    catch (error) {
        console.error('Erro ao adicionar histórico:', error);
    }
}

async function aguardarContaCriada(idCliente: number, tentativas = 5, intervaloMs = 1000) {
    for (let i = 0; i < tentativas; i++) {
        const contas = await apiJango().getConta(idCliente, true);
        if (contas.length > 0) return contas;
        await new Promise(res => setTimeout(res, intervaloMs));
    }
    throw new Error('Conta não foi criada após múltiplas tentativas.');
}

module.exports = {
    async get(req: any, res: any, next: any) {
        try {
            const result = await getRegistros(Ingresso, req, res, next, [
                {
                    model: Evento,
                    as: 'Evento',
                    attributes: ['nome', 'imagem', 'data_hora_inicio', 'endereco'],
                },
                {
                    model: EventoIngresso,
                    as: 'EventoIngresso',
                    attributes: ['nome'],
                },
                {
                    model: TipoIngresso,
                    as: 'TipoIngresso',
                    attributes: ['descricao'],
                },
                {
                    model: Usuario,
                    as: 'Usuario',
                    attributes: ['nomeCompleto', 'cpf', 'email'],
                },
            ], true);

            const { data, meta } = result ?? { data: [], meta: { totalItems: 0, totalPages: 0, currentPage: 0, pageSize: 0 } };

            const dataComQrCode = await Promise.all(
                data.map(async (registro: any) => {
                    const payload = {
                        idqrcode: registro.qrcode,
                    };

                    const qrCodeBase64 = await QRCode.toDataURL(JSON.stringify(payload));

                    return {
                        ...registro,
                        qrCodeBase64
                    };
                })
            );

            res.status(200).json({
                data: dataComQrCode,
                meta
            });
        } catch (err) {
            next(err);
        }
    },

    async add(req: any, res: any, next: any) {
        try {
            let { idEvento, idEventoIngresso, idTipoIngresso, idUsuario, idTransacao, tipo, idUsuarioCriouIngresso, status } = req.body;

            console.log('Adicionando ingresso:', req.body);
            if (!status) {
                status = 'Reservado';
            }

            //   // Validação básica
            if (!idEvento || !idEventoIngresso || !idTipoIngresso || !idUsuario) {
                throw new CustomError('Faltando informações em campos obrigatórios.', 400, '');
            }

            const dataValidade = new Date(); // Data atual
            const dataNascimento = new Date(); // Data atual

            const eventoIngresso = await EventoIngresso.findByPk(idEventoIngresso);
            if (eventoIngresso?.nome.includes('Antecipado')) {
                dataValidade.setDate(dataValidade.getDate() + 1);
            }

            if (!tipo) {
                tipo = TipoVendidoCortesia.Vendido;
            }

            if (!idUsuarioCriouIngresso) {
                idUsuarioCriouIngresso = idUsuario; // Se não for fornecido, usa
            }

            const registro = await Ingresso.create({ ...req.body, status, dataValidade, dataNascimento, tipo });
            // const qrData = `qrcode:${registro.qrcode}`
            // const qrCodeBase64 = await QRCode.toDataURL(qrData);

            // Adiciona o histórico após a criação do ingresso
            await addHistorico(registro.id, idUsuario, 'Ingresso criado com sucesso.');

            if (!eventoIngresso) {
                throw new CustomError('EventoIngresso não encontrado.', 404, '');
            }

            if (idTransacao) {
                await addIngressoTransacao(idTransacao, registro.id, eventoIngresso.preco, eventoIngresso.taxaServico, eventoIngresso.valor);
                // Adiciona o histórico após a criação do ingresso
                await addHistorico(registro.id, idUsuario, 'Vinculado a transação ' + idTransacao);
            }

            return res.status(201).json(registro);
        } catch (error) {
            next(error);
        }
    },

    async edit(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            const registro = await Ingresso.findByPk(id);
            if (!registro) {
                throw new CustomError('Registro não encontrado.', 404, '');
            }

            // Atualizar apenas os campos que estão definidos (não são undefined)
            Object.keys(req.body).forEach(field => {
                if (req.body[field] !== undefined && field in registro) {
                    (registro as any)[field] = req.body[field];
                }
            });

            await registro.save();
            return res.status(200).json(registro);
        } catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },

    async editNomeImpresso(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            const registro = await Ingresso.findByPk(id);
            if (!registro) {
                throw new CustomError('Registro não encontrado.', 404, '');
            }

            const { nomeImpresso } = req.body;
            if (!nomeImpresso) {
                throw new CustomError('Nome impresso é obrigatório.', 400, '');
            }

            registro.nomeImpresso = nomeImpresso;

            await registro.save();
            return res.status(200).json(registro);
        } catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },

    async delete(req: any, res: any, next: any) {
        try {
            const id = req.params.id;

            if (!id) {
                throw new CustomError('ID do registro é obrigatório.', 400, '');
            }

            // Verificar se o usuário existe
            const registro = await Ingresso.findByPk(id);
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

    async atribuirOutroUsuario(req: any, res: any, next: any) {
        try {
            const id = req.params.id;
            const { idUsuarioNovo, NomeUsuarioNovo, idUsuario } = req.body;

            const registro = await Ingresso.findByPk(id);
            if (!registro) {
                throw new CustomError('Registro não encontrado.', 404, '');
            }

            if (!idUsuarioNovo) {
                throw new CustomError('Nome é obrigatório.', 400, '');
            }

            registro.idUsuario = idUsuarioNovo;
            registro.qrcode = uuidv4(); // Limpa o QRCode ao atribuir a outro usuário
            registro.atribuirOutroUsuario = true; // Marca como atribuído a outro usuário
            await addHistorico(registro.id, idUsuario, 'Ingresso atribuído a ' + NomeUsuarioNovo);

            await registro.save();
            return res.status(200).json(registro);
        } catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },

    async validadorJango(req: any, res: any, next: any) {
        try {
            const { ingressos, idUsuario } = req.body;

            console.log('Validador Jango - Ingressos:asdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfa');

            // Verifica se o array de ingressos está vazio
            if (!ingressos || ingressos.length === 0) {
                throw new CustomError('Nenhum ingresso marcado para abrir conta!', 400, '');
            }

            // Verifica se o array de ingressos contém objetos
            if (!Array.isArray(ingressos) || !ingressos.every(item => typeof item === 'number')) {
                throw new CustomError('Formato inválido para o array de ingressos.', 400, '');
            }

            // Verifica se o array de ingressos contém IDs válidos
            const idsValidos = ingressos.filter(id => typeof id === 'number' && id > 0);
            if (idsValidos.length === 0) {
                throw new CustomError('Nenhum ID de ingresso válido encontrado.', 400, '');
            }

            // Verifica se o array de ingressos contém IDs duplicados
            const idsDuplicados = ingressos.filter((item, index) => ingressos.indexOf(item) !== index);
            if (idsDuplicados.length > 0) {
                throw new CustomError('IDs duplicados encontrados: ' + idsDuplicados.join(', '), 400, '');
            }

            // Verifica se os ingressos existem no banco de dados
            const ingressosExistentes = await Ingresso.findAll({
                where: {
                    id: idsValidos,
                },
            });
            if (ingressosExistentes.length !== idsValidos.length) {
                const idsNaoEncontrados = idsValidos.filter(id => !ingressosExistentes.some(ingresso => ingresso.id === id));
                throw new CustomError('Ingressos não encontrados: ' + idsNaoEncontrados.join(', '), 404, '');
            }

            // Verifica se os ingressos estão disponíveis
            const ingressosIndisponiveis = ingressosExistentes.filter(ingresso => ingresso.status !== 'Confirmado');
            if (ingressosIndisponiveis.length > 0) {
                const idsIndisponiveis = ingressosIndisponiveis.map(ingresso => ingresso.id);
                throw new CustomError('Ingressos não disponíveis: ' + idsIndisponiveis.join(', '), 400, '');
            }

            const user = await Usuario.findByPk(idUsuario);
            if (!user) {
                throw new CustomError('Usuário validador não encontrado.', 404, '');
            }

            //Pegar idCliente Jango no usuário do ingresso
            const userIngresso = await Usuario.findByPk(ingressosExistentes[0].idUsuario);
            if (!userIngresso) {
                throw new CustomError('Usuário ingresso não encontrado.', 404, '');
            }

            if (!userIngresso.id_cliente || Number(userIngresso.id_cliente) === 0) {
                if (userIngresso.cpf) {
                    console.log('CPF do usuário do ingresso:', userIngresso.cpf);
                    const dadosJango = await apiJango().getCliente(userIngresso.cpf.toString());
                    let clienteJango = dadosJango[0]
                    if (!clienteJango) {
                        await apiJango().atualizarCliente({
                            CPF_CNPJ: (userIngresso.cpf ?? "").replace(/\D/g, ""),
                            NOME: userIngresso.nomeCompleto,
                            TELEFONE_CELULAR: (userIngresso.telefone ?? "").replace(/\D/g, ""),
                            EMAIL: userIngresso.email,
                        });
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                        const dadosJango = await apiJango().getCliente((userIngresso.cpf ?? "").replace(/\D/g, ""));
                        clienteJango = dadosJango[0];
                    }

                    if (clienteJango.error) {
                        throw new CustomError(clienteJango.error, 400, '');
                    }
                    if (!clienteJango.id_cliente || Number(clienteJango.id_cliente) === 0) {
                        throw new CustomError('Cliente Jango retornou ID inválido.', 400, '');
                    }

                    userIngresso.id_cliente = clienteJango.id_cliente;
                    await userIngresso.save();
                    await userIngresso.reload(); // <-- importante
                } else {
                    throw new CustomError('CPF do usuário do ingresso não encontrado.', 400, '');
                }
            }

            if (!userIngresso.id_cliente || Number(userIngresso.id_cliente) === 0) {
                throw new CustomError('Usuário não possui um id_cliente válido no Jango.', 400, '');
            }

            console.log('ID Cliente Jango:', userIngresso);

            // Localizar conta no Jango Aberta
            let contaJango = await apiJango().getConta(userIngresso.id_cliente, true);

            //Abre Conta no Jango
            if (contaJango.length === 0) {
                await apiJango().abreConta(userIngresso.id_cliente);
                contaJango = await aguardarContaCriada(userIngresso.id_cliente);
            }

            // Localizar conta no Jango Aberta
            contaJango = await apiJango().getConta(userIngresso.id_cliente, true);

            if (contaJango.length > 0) {
                for (const ingresso of ingressosExistentes) {
                    // Atualizar o ingresso no Jango
                    const eventoIngresso = await EventoIngresso.findByPk(ingresso.idEventoIngresso);
                    await apiJango().inseriIngresso(ingresso.id, eventoIngresso?.nome ?? '', userIngresso.id_cliente, contaJango[0].id_venda);

                    await addHistorico(
                        ingresso.id,
                        idUsuario,
                        'Ingresso Inserido no Sistema do Jango '
                    );
                }
            }

            const dataUtilizado = new Date(); // Data atual

            for (const ingresso of ingressosExistentes) {
                ingresso.status = 'Utilizado';
                ingresso.dataUtilizado = dataUtilizado;
                await ingresso.save();
                await addHistorico(
                    ingresso.id,
                    idUsuario,
                    'Ingresso Utilizado ' +
                    formatInTimeZone(
                        dataUtilizado,
                        "America/Cuiaba",
                        "dd/MM/yyyy HH:mm"
                    ) +
                    ' validado por ' + user.nomeCompleto
                );
            }

            return res.status(200).json('Ingressos validados com sucesso!');
        } catch (error) {
            next(error); // Passa o erro para o middleware de tratamento de erros
        }
    },

    async getDadosIngressos(req: any, res: any, next: any) {
        try {
            const { idEvento, dataInicio, dataFim } = req.query;

            if (!idEvento) {
                throw new CustomError('ID do evento é obrigatório.', 400, '');
            }

            const ingressos = await Ingresso.findAll({
                where: {
                    idEvento,
                    status: 'Utilizado',
                    dataUtilizado: {
                        [Op.between]: [dataInicio + ' 00:00:00', dataFim + ' 23:59:59'], // Inclui o final do dia
                    },
                },
                attributes: [
                    [fn('DATE', col('data_utilizado')), 'data'],
                    'id_evento_ingresso',
                    [fn('COUNT', fn('DISTINCT', col('Ingresso.id'))), 'quantidade'], // 👈 AQUI
                ],
                include: [
                    {
                        model: EventoIngresso,
                        as: 'EventoIngresso',
                        attributes: ['nome'],
                    },
                ],
                group: [
                    fn('DATE', col('data_utilizado')),
                    'id_evento_ingresso',
                    col('EventoIngresso.nome'),
                ],
                order: [[fn('DATE', col('data_utilizado')), 'ASC']],
                raw: false,
            });

            const result = {
                data: ingressos,
                meta: {
                    totalItems: ingressos.length,
                    totalPages: 1, // Como estamos retornando todos os dados de uma vez, totalPages é 1
                    currentPage: 1,
                    pageSize: ingressos.length
                }
            };

            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
}
