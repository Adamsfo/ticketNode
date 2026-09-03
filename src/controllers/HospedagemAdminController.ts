import { CustomError } from '../utils/customError';
import {
    listarReservasAdmin,
    listarSituacaoSuites,
    listarSuitesDisponiveisParaTroca,
    obterReservaAdminDetalhe,
    obterSituacaoSuite,
    realizarCheckinAdmin,
    realizarCheckoutAdmin,
    criarReservaRecepcaoAdmin,
    reenviarLinkPagamentoReservaAdmin,
    trocarSuiteReservaAdmin,
    alterarPeriodoReservaAdmin,
    atualizarObservacoesReservaAdmin,
    atualizarUsuarioReserva as atualizarUsuarioReservaService,
} from '../services/hospedagemAdminService';
import { cancelarReservaHospedagemAdmin } from '../services/hospedagemCancelamentoAdminService';
import { parseSuitesCheckout } from '../services/reservaSuiteService';
import { parseDateTimeParam } from '../utils/reservaSuiteUtils';
import { parsePagamentoRecepcao } from '../utils/hospedagemPagamentoRecepcao';
import { obterHospedagemRefreshVersion } from '../services/hospedagemRefreshVersionService';

/**
 * Administração de reservas de hospedagem (produtor / admin).
 */

module.exports = {
    async refreshVersion(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            const data = await obterHospedagemRefreshVersion();
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },

    async listarReservas(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const resultado = await listarReservasAdmin({
                idUsuario,
                busca: req.query.busca ? String(req.query.busca) : '',
                filtro: req.query.filtro ? String(req.query.filtro) : 'todos',
                ordenacao: req.query.ordenacao
                    ? String(req.query.ordenacao)
                    : 'recentes',
                page: Number(req.query.page) || 1,
                pageSize: Number(req.query.pageSize) || 20,
            });

            return res.status(200).json(resultado);
        } catch (error) {
            next(error);
        }
    },

    async detalheReserva(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idReserva = Number(req.params.id);

            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idReserva) {
                throw new CustomError('id da reserva é obrigatório.', 400, '');
            }

            const dataSelecionada = req.query?.data
                ? String(req.query.data)
                : undefined;
            const data = await obterReservaAdminDetalhe(
                idReserva,
                idUsuario,
                dataSelecionada
            );
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },

    async realizarCheckin(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idReserva = Number(req.params.id);

            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idReserva) {
                throw new CustomError('id da reserva é obrigatório.', 400, '');
            }

            const rawDataHora =
                req.body?.dataHora ?? req.body?.dataHoraCheckin ?? null;
            const dataHoraCheckin =
                rawDataHora != null && rawDataHora !== ''
                    ? parseDateTimeParam(rawDataHora, 'dataHora')
                    : null;

            const data = await realizarCheckinAdmin(
                idReserva,
                idUsuario,
                dataHoraCheckin
            );
            return res.status(200).json({
                success: true,
                message: 'Check-in realizado com sucesso.',
                data,
            });
        } catch (error) {
            next(error);
        }
    },

    async cancelarReserva(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idReserva = Number(req.params.id);

            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idReserva) {
                throw new CustomError('id da reserva é obrigatório.', 400, '');
            }

            const result = await cancelarReservaHospedagemAdmin({
                idReservaHospedagem: idReserva,
                idUsuario,
                motivo: req.body?.motivo,
            });

            const data = await obterReservaAdminDetalhe(idReserva, idUsuario);
            return res.status(200).json({
                success: true,
                message: result.alreadyCancelled
                    ? 'Reserva já estava cancelada.'
                    : 'Reserva cancelada com sucesso.',
                data,
            });
        } catch (error) {
            next(error);
        }
    },

    async realizarCheckout(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idReserva = Number(req.params.id);

            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idReserva) {
                throw new CustomError('id da reserva é obrigatório.', 400, '');
            }

            const rawDataHora =
                req.body?.dataHora ?? req.body?.dataHoraCheckout ?? null;
            const dataHoraCheckout =
                rawDataHora != null && rawDataHora !== ''
                    ? parseDateTimeParam(rawDataHora, 'dataHora')
                    : null;

            const data = await realizarCheckoutAdmin(
                idReserva,
                idUsuario,
                dataHoraCheckout
            );
            return res.status(200).json({
                success: true,
                message: 'Check-out realizado.',
                data,
            });
        } catch (error) {
            next(error);
        }
    },

    async criarReservaRecepcao(req: any, res: any, next: any) {
        try {
            const idUsuarioOperador = Number(req.user?.id);
            if (!idUsuarioOperador) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const idEvento = Number(req.body?.idEvento);
            const idUsuarioCliente = Number(req.body?.idUsuario);
            if (!idEvento || !idUsuarioCliente) {
                throw new CustomError(
                    'idEvento e idUsuario (cliente) são obrigatórios.',
                    400,
                    ''
                );
            }
            if (!req.body?.checkin || !req.body?.checkout) {
                throw new CustomError(
                    'checkin e checkout são obrigatórios.',
                    400,
                    ''
                );
            }

            const suites = parseSuitesCheckout(req.body);
            const pagamento = parsePagamentoRecepcao(req.body?.pagamento);
            const data = await criarReservaRecepcaoAdmin({
                idUsuarioOperador,
                idEvento,
                idUsuarioCliente,
                checkin: parseDateTimeParam(req.body.checkin, 'checkin'),
                checkout: parseDateTimeParam(req.body.checkout, 'checkout'),
                suites,
                observacoes: req.body.observacoes
                    ? String(req.body.observacoes)
                    : null,
                pagamento,
            });

            return res.status(201).json({
                success: true,
                message: 'Reserva criada pela recepção.',
                data,
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Nova rota: cria reserva AguardandoPagamento + envia link ao cliente.
     * Não altera POST /hospedagem/reservas/recepcao (Salvar Reserva).
     */
    async enviarReservaParaCliente(req: any, res: any, next: any) {
        try {
            const idUsuarioOperador = Number(req.user?.id);
            if (!idUsuarioOperador) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const idEvento = Number(req.body?.idEvento);
            const idUsuarioCliente = Number(req.body?.idUsuario);
            if (!idEvento || !idUsuarioCliente) {
                throw new CustomError(
                    'idEvento e idUsuario (cliente) são obrigatórios.',
                    400,
                    ''
                );
            }
            if (!req.body?.checkin || !req.body?.checkout) {
                throw new CustomError(
                    'checkin e checkout são obrigatórios.',
                    400,
                    ''
                );
            }

            const suites = parseSuitesCheckout(req.body);
            const data = await criarReservaRecepcaoAdmin({
                idUsuarioOperador,
                idEvento,
                idUsuarioCliente,
                checkin: parseDateTimeParam(req.body.checkin, 'checkin'),
                checkout: parseDateTimeParam(req.body.checkout, 'checkout'),
                suites,
                observacoes: req.body.observacoes
                    ? String(req.body.observacoes)
                    : null,
                enviarParaCliente: true,
                pagamento: null,
            });

            return res.status(201).json({
                success: true,
                message:
                    'Reserva criada e link de pagamento enviado ao cliente.',
                data,
            });
        } catch (error) {
            next(error);
        }
    },

    async reenviarLinkPagamento(req: any, res: any, next: any) {
        try {
            const idUsuarioOperador = Number(req.user?.id);
            const idReserva = Number(req.params.id);
            if (!idUsuarioOperador) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idReserva) {
                throw new CustomError('ID da reserva é obrigatório.', 400, '');
            }

            const data = await reenviarLinkPagamentoReservaAdmin(
                idReserva,
                idUsuarioOperador
            );

            return res.status(200).json({
                success: true,
                message: 'Link de pagamento reenviado ao cliente.',
                data,
            });
        } catch (error) {
            next(error);
        }
    },

    async listarSuitesDisponiveisTroca(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idReserva = Number(req.params.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idReserva) {
                throw new CustomError('id da reserva é obrigatório.', 400, '');
            }

            const idReservaSuite = req.query?.idReservaSuite
                ? Number(req.query.idReservaSuite)
                : undefined;

            const data = await listarSuitesDisponiveisParaTroca({
                idReservaHospedagem: idReserva,
                idUsuario,
                idReservaSuite:
                    idReservaSuite && idReservaSuite > 0
                        ? idReservaSuite
                        : undefined,
            });
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },

    async trocarSuite(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idReserva = Number(req.params.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idReserva) {
                throw new CustomError('id da reserva é obrigatório.', 400, '');
            }

            const idReservaSuite = Number(req.body?.idReservaSuite);
            const idEventoSuiteDestino = Number(req.body?.idEventoSuiteDestino);
            if (!idReservaSuite || !idEventoSuiteDestino) {
                throw new CustomError(
                    'idReservaSuite e idEventoSuiteDestino são obrigatórios.',
                    400,
                    ''
                );
            }

            const data = await trocarSuiteReservaAdmin({
                idReservaHospedagem: idReserva,
                idUsuario,
                idReservaSuite,
                idEventoSuiteDestino,
                motivo: req.body?.motivo ? String(req.body.motivo) : null,
            });

            return res.status(200).json({
                success: true,
                message: 'Suíte alterada com sucesso.',
                data,
            });
        } catch (error) {
            next(error);
        }
    },

    async alterarPeriodo(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idReserva = Number(req.params.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idReserva) {
                throw new CustomError('id da reserva é obrigatório.', 400, '');
            }
            if (!req.body?.checkin || !req.body?.checkout) {
                throw new CustomError(
                    'checkin e checkout são obrigatórios.',
                    400,
                    ''
                );
            }

            const data = await alterarPeriodoReservaAdmin({
                idReservaHospedagem: idReserva,
                idUsuario,
                checkin: parseDateTimeParam(req.body.checkin, 'checkin'),
                checkout: parseDateTimeParam(req.body.checkout, 'checkout'),
                motivo: req.body?.motivo ? String(req.body.motivo) : null,
            });

            return res.status(200).json({
                success: true,
                message: 'Período da reserva alterado com sucesso.',
                data,
            });
        } catch (error) {
            next(error);
        }
    },

    async atualizarObservacoes(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idReserva = Number(req.params.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idReserva) {
                throw new CustomError('id da reserva é obrigatório.', 400, '');
            }
            if (req.body?.observacoes === undefined) {
                throw new CustomError(
                    'observacoes é obrigatório no corpo da requisição.',
                    400,
                    ''
                );
            }

            const data = await atualizarObservacoesReservaAdmin(
                idReserva,
                idUsuario,
                String(req.body.observacoes)
            );

            return res.status(200).json({
                success: true,
                message: 'Observações salvas.',
                data,
            });
        } catch (error) {
            next(error);
        }
    },

    async atualizarUsuarioReserva(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idReserva = Number(req.params.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idReserva) {
                throw new CustomError('id da reserva é obrigatório.', 400, '');
            }
            const { id_cliente } = req.body;
            if (!id_cliente) {
                throw new CustomError('id_cliente é obrigatório.', 400, '');
            }
            await atualizarUsuarioReservaService(idReserva, id_cliente);
            return res.status(200).json({ success: true, message: 'Usuário atualizado.' });
        } catch (error) {
            next(error);
        }
    },

    async listarSuites(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const resultado = await listarSituacaoSuites({
                idUsuario,
                filtro: req.query.filtro ? String(req.query.filtro) : 'todas',
                data: req.query.data ? String(req.query.data) : undefined,
                mes: req.query.mes ? String(req.query.mes) : undefined,
            });

            return res.status(200).json(resultado);
        } catch (error) {
            next(error);
        }
    },

    async detalheSuite(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idEventoSuite = Number(req.params.id);

            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idEventoSuite) {
                throw new CustomError('id da suíte é obrigatório.', 400, '');
            }

            const data = await obterSituacaoSuite(
                idEventoSuite,
                idUsuario,
                req.query.data ? String(req.query.data) : undefined
            );
            return res.status(200).json({ data });
        } catch (error) {
            next(error);
        }
    },
};
