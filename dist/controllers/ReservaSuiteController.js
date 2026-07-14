"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const customError_1 = require("../utils/customError");
const reservaSuiteService_1 = require("../services/reservaSuiteService");
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
};
