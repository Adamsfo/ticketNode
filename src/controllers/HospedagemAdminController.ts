import { CustomError } from '../utils/customError';
import {
    listarReservasAdmin,
    listarSituacaoSuites,
    obterReservaAdminDetalhe,
    obterSituacaoSuite,
    realizarCheckinAdmin,
    realizarCheckoutAdmin,
    criarReservaRecepcaoAdmin,
} from '../services/hospedagemAdminService';
import { parseSuitesCheckout } from '../services/reservaSuiteService';
import { parseDateTimeParam } from '../utils/reservaSuiteUtils';
import { parsePagamentoRecepcao } from '../utils/hospedagemPagamentoRecepcao';

/**
 * Administração de reservas de hospedagem (produtor / admin).
 */

module.exports = {
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

            const data = await obterReservaAdminDetalhe(idReserva, idUsuario);
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

            const data = await realizarCheckinAdmin(idReserva, idUsuario);
            return res.status(200).json({
                success: true,
                message: 'Check-in realizado com sucesso.',
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

            const data = await realizarCheckoutAdmin(idReserva, idUsuario);
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
