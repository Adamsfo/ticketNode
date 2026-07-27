import { CustomError } from '../utils/customError';
import {
    cancelarPagamentoTefHospedagem,
    consultarPagamentoTefHospedagem,
    iniciarPagamentoTefHospedagem,
    receberSaldoDinheiro,
    receberSaldoManual,
} from '../services/hospedagemPagamentoService';

/**
 * Controller próprio da hospedagem.
 * Espelha a sequência do PagamentoPDV (pagamentoPos / consulta / cancela / dinheiro),
 * sem alterar PagamentoController.
 */
module.exports = {
    /** Equivalente a POST /pagamentodinheiro — grava só hospedagem. */
    async receberDinheiro(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id || req.body?.idUsuarioPDV);
            const idReserva = Number(req.params.id);
            const valorTotal = Number(
                req.body?.valorTotal ?? req.body?.pagamento?.valor ?? 0
            );
            if (!idUsuario) throw new CustomError('Usuário não autenticado.', 401, '');
            if (!idReserva) throw new CustomError('id da reserva é obrigatório.', 400, '');

            const result = await receberSaldoDinheiro({
                idReservaHospedagem: idReserva,
                idUsuario,
                valorTotal,
                observacao:
                    req.body?.observacao ??
                    req.body?.pagamento?.observacao ??
                    null,
            });

            // Mesmo envelope do PDV + reserva da hospedagem.
            return res.status(200).json({
                ...result,
                success: true,
                reserva: result.reserva,
            });
        } catch (error) {
            next(error);
        }
    },

    async receberManual(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idReserva = Number(req.params.id);
            if (!idUsuario) throw new CustomError('Usuário não autenticado.', 401, '');
            if (!idReserva) throw new CustomError('id da reserva é obrigatório.', 400, '');

            const data = await receberSaldoManual({
                idReservaHospedagem: idReserva,
                idUsuario,
                pagamentoRaw: req.body?.pagamento ?? req.body,
            });
            return res.status(200).json({
                success: true,
                message: 'Pagamento registrado.',
                data,
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Equivalente a POST /pagamentopos.
     * Body: valorTotal, transaction_type, idUsuarioPDV (obrigatório — igual ao PDV).
     * Retorno: { id: payment_uniqueid, status: 'pending' }
     */
    async iniciarTef(req: any, res: any, next: any) {
        try {
            // PDV usa exclusivamente body.idUsuarioPDV (rota sem JWT).
            // Hospedagem aceita o mesmo campo; JWT só como fallback.
            const idUsuarioPDV = Number(
                req.body?.idUsuarioPDV ?? req.user?.id
            );
            const idReserva = Number(req.params.id);
            if (!idUsuarioPDV) {
                throw new CustomError(
                    'idUsuarioPDV é obrigatório (mesmo campo do PagamentoPDV).',
                    400,
                    ''
                );
            }
            if (!idReserva) throw new CustomError('id da reserva é obrigatório.', 400, '');

            const valorTotal = Number(
                req.body?.valorTotal ?? req.body?.pagamento?.valor ?? 0
            );
            let transactionType = Number(req.body?.transaction_type);
            if (!transactionType) {
                const forma = String(
                    req.body?.formaPagamento ??
                        req.body?.pagamento?.formaPagamento ??
                        ''
                );
                if (forma === 'CartaoDebito') transactionType = 1;
                else if (forma === 'CartaoCredito') transactionType = 2;
                else if (forma === 'PIX') transactionType = 3;
            }

            const data = await iniciarPagamentoTefHospedagem({
                idReservaHospedagem: idReserva,
                idUsuario: idUsuarioPDV,
                valorTotal,
                transaction_type: transactionType,
                observacao:
                    req.body?.observacao ??
                    req.body?.pagamento?.observacao ??
                    null,
            });

            // Mesmo retorno do PDV (sem envelope extra que quebre o front).
            return res.status(200).json(data);
        } catch (error: any) {
            // Mesma resposta do PDV quando não há ProdutorAcesso.
            if (
                error instanceof CustomError &&
                String(error.message) === 'ProdutorAcesso não encontrado'
            ) {
                return res
                    .status(404)
                    .json({ error: 'ProdutorAcesso não encontrado' });
            }
            if (error instanceof CustomError) {
                return next(error);
            }
            console.error('Erro ao criar pagamento POS hospedagem:', error);
            return res.status(500).json({ error: 'Erro ao gerar pagamento Pix' });
        }
    },

    /**
     * Equivalente a GET /consultapagamentopos?filters={payment_uniqueid}.
     * Retorno: { data: { ...supertef, payment_message } }
     */
    async consultarTef(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idReserva = Number(req.params.id);
            if (!idUsuario) throw new CustomError('Usuário não autenticado.', 401, '');
            if (!idReserva) throw new CustomError('id da reserva é obrigatório.', 400, '');

            let payment_uniqueid = String(
                req.query.payment_uniqueid ||
                    req.body?.payment_uniqueid ||
                    ''
            );
            if (!payment_uniqueid && req.query.filters) {
                try {
                    const filters =
                        typeof req.query.filters === 'string'
                            ? JSON.parse(req.query.filters)
                            : req.query.filters;
                    payment_uniqueid = String(filters?.payment_uniqueid || '');
                } catch {
                    payment_uniqueid = '';
                }
            }

            const result = await consultarPagamentoTefHospedagem({
                idReservaHospedagem: idReserva,
                idUsuario,
                payment_uniqueid,
            });

            return res.status(200).json(result);
        } catch (error: any) {
            if (error instanceof CustomError) {
                return next(error);
            }
            console.error('Erro ao processar POS hospedagem:', error);
            return res.status(500).json({ error: 'Erro ao processar POS' });
        }
    },

    /**
     * Equivalente a GET /cancelapagamentopos?filters={payment_uniqueid}.
     * Retorno: { data: ... }
     */
    async cancelarTef(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idReserva = Number(req.params.id);
            if (!idUsuario) throw new CustomError('Usuário não autenticado.', 401, '');
            if (!idReserva) throw new CustomError('id da reserva é obrigatório.', 400, '');

            let payment_uniqueid = String(
                req.body?.payment_uniqueid ||
                    req.query.payment_uniqueid ||
                    ''
            );
            if (!payment_uniqueid && req.query.filters) {
                try {
                    const filters =
                        typeof req.query.filters === 'string'
                            ? JSON.parse(req.query.filters)
                            : req.query.filters;
                    payment_uniqueid = String(filters?.payment_uniqueid || '');
                } catch {
                    payment_uniqueid = '';
                }
            }

            const result = await cancelarPagamentoTefHospedagem({
                idReservaHospedagem: idReserva,
                idUsuario,
                payment_uniqueid,
            });

            return res.status(200).json(result);
        } catch (error: any) {
            if (error instanceof CustomError) {
                return next(error);
            }
            console.error('Erro ao processar POS hospedagem:', error);
            return res.status(500).json({ error: 'Erro ao processar POS' });
        }
    },

    /** Compat: finalizar = consultar (PDV efetiva na consulta). */
    async finalizarTef(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idReserva = Number(req.params.id);
            const payment_uniqueid = String(req.body?.payment_uniqueid || '');
            if (!idUsuario) throw new CustomError('Usuário não autenticado.', 401, '');
            if (!idReserva) throw new CustomError('id da reserva é obrigatório.', 400, '');

            const result = await consultarPagamentoTefHospedagem({
                idReservaHospedagem: idReserva,
                idUsuario,
                payment_uniqueid,
            });
            return res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },
};
