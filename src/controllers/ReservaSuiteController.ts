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

    autenticarReservaPublicaPorToken,

    salvarHospedesReservaPublicaPorToken,

} from '../services/reservaSuiteService';

import {
    listarMinhasReservas,
    obterMinhaReservaDetalhe,
} from '../services/minhasReservasService';
import { cancelarMinhaReservaHospedagem } from '../services/hospedagemCancelamentoClienteService';
import {
    obterStatusRemarcacaoMinhaReserva,
    remarcarMinhaReservaHospedagem,
} from '../services/hospedagemRemarcacaoClienteService';
import {
    consultarPagamentoRemarcacaoCliente,
    criarPagamentoCartaoRemarcacaoCliente,
    criarPagamentoPixRemarcacaoCliente,
    obterPixRemarcacaoPendenteCliente,
} from '../services/hospedagemRemarcacaoPagamentoService';
import { processarWebhookMercadoPagoRemarcacao } from '../services/hospedagemRemarcacaoWebhookService';



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

    async minhasReservas(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const resultado = await listarMinhasReservas({
                idUsuario,
                status: req.query.status,
                page: Number(req.query.page) || 1,
                pageSize: Number(req.query.pageSize) || 20,
            });

            return res.status(200).json(resultado);
        } catch (error) {
            next(error);
        }
    },

    async minhaReservaDetalhe(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const idReserva = Number(req.params.id);
            const resultado = await obterMinhaReservaDetalhe(idReserva, idUsuario);

            return res.status(200).json({ data: resultado });
        } catch (error) {
            next(error);
        }
    },

    async cancelarMinhaReserva(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const idReserva = Number(req.params.id);
            const resultado = await cancelarMinhaReservaHospedagem(
                idReserva,
                idUsuario
            );

            return res.status(200).json({
                success: true,
                message: 'Reserva cancelada com sucesso.',
                data: resultado,
            });
        } catch (error) {
            next(error);
        }
    },

    async remarcarMinhaReserva(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const idReserva = Number(req.params.id);
            const resultado = await remarcarMinhaReservaHospedagem(
                idReserva,
                idUsuario,
                {
                    dataCheckIn: req.body?.dataCheckIn,
                    dataCheckOut: req.body?.dataCheckOut,
                }
            );

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
        } catch (error) {
            next(error);
        }
    },

    async statusRemarcacaoMinhaReserva(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const idReserva = Number(req.params.id);
            const resultado = await obterStatusRemarcacaoMinhaReserva(
                idReserva,
                idUsuario
            );

            return res.status(200).json({ success: true, data: resultado });
        } catch (error) {
            next(error);
        }
    },

    async pagamentoPixRemarcacaoMinhaReserva(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const idReserva = Number(req.params.id);
            const email = String(req.body?.email ?? req.user?.email ?? '').trim();
            if (!email) {
                throw new CustomError('E-mail do pagador é obrigatório.', 400, '');
            }

            const resultado = await criarPagamentoPixRemarcacaoCliente({
                idReserva,
                idUsuario,
                email,
            });

            return res.status(200).json({ success: true, data: resultado });
        } catch (error) {
            next(error);
        }
    },

    async pagamentoCartaoRemarcacaoMinhaReserva(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const idReserva = Number(req.params.id);
            const resultado = await criarPagamentoCartaoRemarcacaoCliente({
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
        } catch (error) {
            next(error);
        }
    },

    async pixPendenteRemarcacaoMinhaReserva(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const idReserva = Number(req.params.id);
            const resultado = await obterPixRemarcacaoPendenteCliente(
                idReserva,
                idUsuario
            );

            return res.status(200).json({ success: true, data: resultado });
        } catch (error) {
            next(error);
        }
    },

    async webhookMercadoPagoRemarcacao(req: any, res: any, next: any) {
        try {
            const type = req.body?.type;
            const paymentId = String(req.body?.data?.id ?? '').trim();

            if (type !== 'payment' || !paymentId) {
                return res.status(400).json({
                    success: false,
                    message: 'Webhook de remarcação inválido.',
                });
            }

            const resultado = await processarWebhookMercadoPagoRemarcacao(
                paymentId
            );

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
        } catch (error) {
            next(error);
        }
    },

    async consultaPagamentoRemarcacaoMinhaReserva(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const idReserva = Number(req.params.id);
            const paymentId = String(
                req.query?.paymentId ?? req.body?.paymentId ?? ''
            ).trim();
            if (!paymentId) {
                throw new CustomError('paymentId é obrigatório.', 400, '');
            }

            const resultado = await consultarPagamentoRemarcacaoCliente({
                idReserva,
                idUsuario,
                paymentId,
            });

            return res.status(200).json({ success: true, data: resultado });
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

    /** Magic login: token da reserva → JWT do cliente (mesmo formato do /login). */
    async autenticarReservaPublicaPorToken(req: any, res: any, next: any) {
        try {
            const token = String(req.params.token || '').trim();
            const jwt = await autenticarReservaPublicaPorToken(token);
            return res.status(200).json({ data: jwt });
        } catch (error) {
            next(error);
        }
    },

    /** Salva hóspedes do link público — exige JWT do dono da reserva. */
    async salvarHospedesReservaPublicaPorToken(req: any, res: any, next: any) {
        try {
            const token = String(req.params.token || '').trim();
            const idUsuario = Number(req.user?.id);
            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }

            const data = await salvarHospedesReservaPublicaPorToken(
                token,
                req.body,
                idUsuario
            );
            return res.status(200).json({ success: true, data });
        } catch (error) {
            next(error);
        }
    },

};


