/**
 * Endpoint legado de receber saldo.
 * Delega para o registrador exclusivo da hospedagem (sem Transacao/Ingresso).
 */
import { CustomError } from '../utils/customError';
import { parsePagamentoRecepcao } from '../utils/hospedagemPagamentoRecepcao';
import { registrarPagamentoHospedagem } from './hospedagemPagamentoService';

export async function receberSaldoHospedagem(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    pagamentoRaw: unknown;
}) {
    const pagamento = parsePagamentoRecepcao(params.pagamentoRaw);
    if (!pagamento || pagamento.valor <= 0) {
        throw new CustomError(
            'Informe um valor maior que zero para receber o saldo.',
            400,
            ''
        );
    }

    return registrarPagamentoHospedagem({
        idReservaHospedagem: params.idReservaHospedagem,
        idUsuario: params.idUsuario,
        pagamento,
    });
}
