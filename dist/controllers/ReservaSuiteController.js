"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const customError_1 = require("../utils/customError");
const reservaSuiteService_1 = require("../services/reservaSuiteService");
const minhasReservasService_1 = require("../services/minhasReservasService");
const hospedagemCancelamentoClienteService_1 = require("../services/hospedagemCancelamentoClienteService");
const hospedagemRemarcacaoClienteService_1 = require("../services/hospedagemRemarcacaoClienteService");
const hospedagemRemarcacaoPagamentoService_1 = require("../services/hospedagemRemarcacaoPagamentoService");
const hospedagemRemarcacaoWebhookService_1 = require("../services/hospedagemRemarcacaoWebhookService");
module.exports = {
    async disponibilidade(req, res, next) {
        try {
            const params = (0, reservaSuiteService_1.parseParamsDisponibilidade)(req.query);
            const resultado = await (0, reservaSuiteService_1.listarSuitesDisponiveis)(params);
            return res.status(200).json({ data: resultado });
        }
        catch (error) {
            next(error);
        }
    },
    async cotacao(req, res, next) {
        try {
            const params = (0, reservaSuiteService_1.parseParamsCotacao)(req.query);
            const resultado = await (0, reservaSuiteService_1.calcularCotacao)(params);
            return res.status(200).json({ data: resultado });
        }
        catch (error) {
            next(error);
        }
    },
    async criar(req, res, next) {
        try {
            throw new customError_1.CustomError('Use POST /reservasuite/checkout com array suites para criar hospedagem.', 410, '');
        }
        catch (error) {
            next(error);
        }
    },
    async checkout(req, res, next) {
        try {
            const { idEvento, idUsuario, checkin, checkout } = req.body;
            const idUsuarioFinal = idUsuario ?? req.user?.id;
            const suites = (0, reservaSuiteService_1.parseSuitesCheckout)(req.body);
            if (!idEvento || !idUsuarioFinal) {
                throw new customError_1.CustomError('idEvento e idUsuario são obrigatórios.', 400, '');
            }
            if (!checkin || !checkout) {
                throw new customError_1.CustomError('checkin e checkout são obrigatórios.', 400, '');
            }
            const checkinDate = new Date(checkin);
            const checkoutDate = new Date(checkout);
            if (Number.isNaN(checkinDate.getTime()) ||
                Number.isNaN(checkoutDate.getTime())) {
                throw new customError_1.CustomError('checkin ou checkout inválidos.', 400, '');
            }
            if (checkinDate >= checkoutDate) {
                throw new customError_1.CustomError('check-out deve ser após o check-in.', 400, '');
            }
            const resultado = await (0, reservaSuiteService_1.checkoutHospedagem)({
                idEvento: Number(idEvento),
                idUsuario: Number(idUsuarioFinal),
                checkin: checkinDate,
                checkout: checkoutDate,
                suites,
            });
            return res.status(201).json({ data: resultado });
        }
        catch (error) {
            next(error);
        }
    },
    async resumoPagamento(req, res, next) {
        try {
            const idTransacao = Number(req.query.idTransacao);
            if (!idTransacao) {
                throw new customError_1.CustomError('idTransacao é obrigatório.', 400, '');
            }
            const resultado = await (0, reservaSuiteService_1.obterResumoPagamentoPorTransacao)(idTransacao);
            if (!resultado) {
                throw new customError_1.CustomError('Reserva de hospedagem não encontrada.', 404, '');
            }
            return res.status(200).json({ data: resultado });
        }
        catch (error) {
            next(error);
        }
    },
    async minhasReservas(req, res, next) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new customError_1.CustomError('Usuário não autenticado.', 401, '');
            }
            const resultado = await (0, minhasReservasService_1.listarMinhasReservas)({
                idUsuario,
                status: req.query.status,
                page: Number(req.query.page) || 1,
                pageSize: Number(req.query.pageSize) || 20,
            });
            return res.status(200).json(resultado);
        }
        catch (error) {
            next(error);
        }
    },
    async minhaReservaDetalhe(req, res, next) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new customError_1.CustomError('Usuário não autenticado.', 401, '');
            }
            const idReserva = Number(req.params.id);
            const resultado = await (0, minhasReservasService_1.obterMinhaReservaDetalhe)(idReserva, idUsuario);
            return res.status(200).json({ data: resultado });
        }
        catch (error) {
            next(error);
        }
    },
    async cancelarMinhaReserva(req, res, next) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new customError_1.CustomError('Usuário não autenticado.', 401, '');
            }
            const idReserva = Number(req.params.id);
            const resultado = await (0, hospedagemCancelamentoClienteService_1.cancelarMinhaReservaHospedagem)(idReserva, idUsuario);
            return res.status(200).json({
                success: true,
                message: 'Reserva cancelada com sucesso.',
                data: resultado,
            });
        }
        catch (error) {
            next(error);
        }
    },
    async remarcarMinhaReserva(req, res, next) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new customError_1.CustomError('Usuário não autenticado.', 401, '');
            }
            const idReserva = Number(req.params.id);
            const resultado = await (0, hospedagemRemarcacaoClienteService_1.remarcarMinhaReservaHospedagem)(idReserva, idUsuario, {
                dataCheckIn: req.body?.dataCheckIn,
                dataCheckOut: req.body?.dataCheckOut,
            });
            const message = resultado.remarcada
                ? 'Remarcação realizada com sucesso.'
                : resultado.aguardandoPagamento
                    ? 'Remarcação registrada. Aguardando pagamento da taxa.'
                    : 'Solicitação de remarcação registrada.';
            return res.status(200).json({
                success: true,
                message,
                data: resultado,
            });
        }
        catch (error) {
            next(error);
        }
    },
    async statusRemarcacaoMinhaReserva(req, res, next) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new customError_1.CustomError('Usuário não autenticado.', 401, '');
            }
            const idReserva = Number(req.params.id);
            const resultado = await (0, hospedagemRemarcacaoClienteService_1.obterStatusRemarcacaoMinhaReserva)(idReserva, idUsuario);
            return res.status(200).json({ success: true, data: resultado });
        }
        catch (error) {
            next(error);
        }
    },
    async pagamentoPixRemarcacaoMinhaReserva(req, res, next) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new customError_1.CustomError('Usuário não autenticado.', 401, '');
            }
            const idReserva = Number(req.params.id);
            const email = String(req.body?.email ?? req.user?.email ?? '').trim();
            if (!email) {
                throw new customError_1.CustomError('E-mail do pagador é obrigatório.', 400, '');
            }
            const resultado = await (0, hospedagemRemarcacaoPagamentoService_1.criarPagamentoPixRemarcacaoCliente)({
                idReserva,
                idUsuario,
                email,
            });
            return res.status(200).json({ success: true, data: resultado });
        }
        catch (error) {
            next(error);
        }
    },
    async pagamentoCartaoRemarcacaoMinhaReserva(req, res, next) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new customError_1.CustomError('Usuário não autenticado.', 401, '');
            }
            const idReserva = Number(req.params.id);
            const resultado = await (0, hospedagemRemarcacaoPagamentoService_1.criarPagamentoCartaoRemarcacaoCliente)({
                idReserva,
                idUsuario,
                token: req.body?.token,
                payment_method_id: req.body?.payment_method_id,
                issuer_id: req.body?.issuer_id,
                installments: Number(req.body?.installments) || 1,
                payer: req.body?.payer,
                deviceId: req.body?.deviceId,
            });
            return res.status(200).json({ success: true, data: resultado });
        }
        catch (error) {
            next(error);
        }
    },
    async pixPendenteRemarcacaoMinhaReserva(req, res, next) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new customError_1.CustomError('Usuário não autenticado.', 401, '');
            }
            const idReserva = Number(req.params.id);
            const resultado = await (0, hospedagemRemarcacaoPagamentoService_1.obterPixRemarcacaoPendenteCliente)(idReserva, idUsuario);
            return res.status(200).json({ success: true, data: resultado });
        }
        catch (error) {
            next(error);
        }
    },
    async webhookMercadoPagoRemarcacao(req, res, next) {
        try {
            const type = req.body?.type;
            const paymentId = String(req.body?.data?.id ?? '').trim();
            if (type !== 'payment' || !paymentId) {
                return res.status(400).json({
                    success: false,
                    message: 'Webhook de remarcação inválido.',
                });
            }
            const resultado = await (0, hospedagemRemarcacaoWebhookService_1.processarWebhookMercadoPagoRemarcacao)(paymentId);
            if (resultado.ignorado) {
                return res.status(200).json({
                    success: true,
                    message: 'Pagamento não pertence à remarcação.',
                    data: resultado,
                });
            }
            return res.status(200).json({
                success: true,
                message: 'Webhook de remarcação processado.',
                data: resultado,
            });
        }
        catch (error) {
            next(error);
        }
    },
    async consultaPagamentoRemarcacaoMinhaReserva(req, res, next) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new customError_1.CustomError('Usuário não autenticado.', 401, '');
            }
            const idReserva = Number(req.params.id);
            const paymentId = String(req.query?.paymentId ?? req.body?.paymentId ?? '').trim();
            if (!paymentId) {
                throw new customError_1.CustomError('paymentId é obrigatório.', 400, '');
            }
            const resultado = await (0, hospedagemRemarcacaoPagamentoService_1.consultarPagamentoRemarcacaoCliente)({
                idReserva,
                idUsuario,
                paymentId,
            });
            return res.status(200).json({ success: true, data: resultado });
        }
        catch (error) {
            next(error);
        }
    },
    async reservaConfirmada(req, res, next) {
        try {
            const idTransacao = Number(req.query.idTransacao ?? req.params.idTransacao);
            const idUsuario = Number(req.user?.id);
            if (!idTransacao) {
                throw new customError_1.CustomError('idTransacao é obrigatório.', 400, '');
            }
            if (!idUsuario) {
                throw new customError_1.CustomError('Usuário não autenticado.', 401, '');
            }
            const resultado = await (0, reservaSuiteService_1.obterReservaConfirmadaPorTransacao)(idTransacao, idUsuario);
            if (!resultado) {
                throw new customError_1.CustomError('Reserva de hospedagem não encontrada.', 404, '');
            }
            return res.status(200).json({ data: resultado });
        }
        catch (error) {
            next(error);
        }
    },
    /** Página pública /reserva/TOKEN — não altera APIs autenticadas existentes. */
    async reservaPublicaPorToken(req, res, next) {
        try {
            const token = String(req.params.token || '').trim();
            const data = await (0, reservaSuiteService_1.obterReservaPublicaPorToken)(token);
            return res.status(200).json({ success: true, data });
        }
        catch (error) {
            next(error);
        }
    },
    /** Magic login: token da reserva → JWT do cliente (mesmo formato do /login). */
    async autenticarReservaPublicaPorToken(req, res, next) {
        try {
            const token = String(req.params.token || '').trim();
            const jwt = await (0, reservaSuiteService_1.autenticarReservaPublicaPorToken)(token);
            return res.status(200).json({ data: jwt });
        }
        catch (error) {
            next(error);
        }
    },
    /** Salva hóspedes do link público — exige JWT do dono da reserva. */
    async salvarHospedesReservaPublicaPorToken(req, res, next) {
        try {
            const token = String(req.params.token || '').trim();
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new customError_1.CustomError('Usuário não autenticado.', 401, '');
            }
            const data = await (0, reservaSuiteService_1.salvarHospedesReservaPublicaPorToken)(token, req.body, idUsuario);
            return res.status(200).json({ success: true, data });
        }
        catch (error) {
            next(error);
        }
    },
};
