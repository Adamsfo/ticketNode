import { CustomError } from '../utils/customError';

import {

    calcularCotacao,

    checkoutHospedagem,

    listarSuitesDisponiveis,

    parseParamsCotacao,

    parseParamsDisponibilidade,

    parseSuitesCheckout,

    obterResumoPagamentoPorTransacao,

    obterReservaConfirmadaPorTransacao,

    obterReservaPublicaPorToken,

} from '../services/reservaSuiteService';



module.exports = {

    async disponibilidade(req: any, res: any, next: any) {

        try {

            const params = parseParamsDisponibilidade(req.query);

            const resultado = await listarSuitesDisponiveis(params);

            return res.status(200).json({ data: resultado });

        } catch (error) {

            next(error);

        }

    },



    async cotacao(req: any, res: any, next: any) {

        try {

            const params = parseParamsCotacao(req.query);

            const resultado = await calcularCotacao(params);

            return res.status(200).json({ data: resultado });

        } catch (error) {

            next(error);

        }

    },



    async criar(req: any, res: any, next: any) {

        try {

            throw new CustomError(

                'Use POST /reservasuite/checkout com array suites para criar hospedagem.',

                410,

                ''

            );

        } catch (error) {

            next(error);

        }

    },



    async checkout(req: any, res: any, next: any) {

        try {

            const { idEvento, idUsuario, checkin, checkout } = req.body;

            const idUsuarioFinal = idUsuario ?? req.user?.id;

            const suites = parseSuitesCheckout(req.body);



            if (!idEvento || !idUsuarioFinal) {

                throw new CustomError(

                    'idEvento e idUsuario são obrigatórios.',

                    400,

                    ''

                );

            }



            if (!checkin || !checkout) {

                throw new CustomError('checkin e checkout são obrigatórios.', 400, '');

            }



            const checkinDate = new Date(checkin);

            const checkoutDate = new Date(checkout);

            if (

                Number.isNaN(checkinDate.getTime()) ||

                Number.isNaN(checkoutDate.getTime())

            ) {

                throw new CustomError('checkin ou checkout inválidos.', 400, '');

            }



            if (checkinDate >= checkoutDate) {

                throw new CustomError('check-out deve ser após o check-in.', 400, '');

            }



            const resultado = await checkoutHospedagem({

                idEvento: Number(idEvento),

                idUsuario: Number(idUsuarioFinal),

                checkin: checkinDate,

                checkout: checkoutDate,

                suites,

            });



            return res.status(201).json({ data: resultado });

        } catch (error) {

            next(error);

        }

    },

    async resumoPagamento(req: any, res: any, next: any) {
        try {
            const idTransacao = Number(req.query.idTransacao);
            if (!idTransacao) {
                throw new CustomError('idTransacao é obrigatório.', 400, '');
            }

            const resultado = await obterResumoPagamentoPorTransacao(idTransacao);
            if (!resultado) {
                throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
            }

            return res.status(200).json({ data: resultado });
        } catch (error) {
            next(error);
        }
    },

    async reservaConfirmada(req: any, res: any, next: any) {
        try {
            const idTransacao = Number(req.query.idTransacao ?? req.params.idTransacao);
            const idUsuario = Number(req.user?.id);

            if (!idTransacao) {
                throw new CustomError('idTransacao é obrigatório.', 400, '');
            }

            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const resultado = await obterReservaConfirmadaPorTransacao(
                idTransacao,
                idUsuario
            );

            if (!resultado) {
                throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
            }

            return res.status(200).json({ data: resultado });
        } catch (error) {
            next(error);
        }
    },

    /** Página pública /reserva/TOKEN — não altera APIs autenticadas existentes. */
    async reservaPublicaPorToken(req: any, res: any, next: any) {
        try {
            const token = String(req.params.token || '').trim();
            const data = await obterReservaPublicaPorToken(token);
            return res.status(200).json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },

};


