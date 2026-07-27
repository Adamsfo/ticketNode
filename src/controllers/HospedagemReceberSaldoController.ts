import { CustomError } from '../utils/customError';
import { receberSaldoHospedagem } from '../services/hospedagemReceberSaldoService';

/**
 * Controller isolado do recebimento de saldo da hospedagem.
 * Não compartilha handlers com PagamentoPDV.
 */
module.exports = {
    async receberSaldo(req: any, res: any, next: any) {
        try {
            const idUsuario = Number(req.user?.id);
            const idReserva = Number(req.params.id);

            if (!idUsuario) {
                throw new CustomError('Usuário não autenticado.', 401, '');
            }
            if (!idReserva) {
                throw new CustomError('id da reserva é obrigatório.', 400, '');
            }

            const pagamentoRaw = req.body?.pagamento ?? req.body;
            const data = await receberSaldoHospedagem({
                idReservaHospedagem: idReserva,
                idUsuario,
                pagamentoRaw,
            });

            return res.status(200).json({
                success: true,
                message: 'Saldo recebido com sucesso.',
                data,
            });
        } catch (error) {
            next(error);
        }
    },
};
