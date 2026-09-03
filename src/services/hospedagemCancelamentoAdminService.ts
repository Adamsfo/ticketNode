import {
    ReservaHospedagem,
    StatusReservaHospedagem,
} from '../models/ReservaHospedagem';
import { CustomError } from '../utils/customError';
import { cancelarReservaHospedagem } from './reservaSuiteService';

export type CancelamentoAdminStatusResult =
    | { action: 'idempotent' }
    | { action: 'cancel' };

export function validarMotivoCancelamentoAdmin(motivo: unknown): string {
    const texto = String(motivo ?? '').trim();
    if (!texto) {
        throw new CustomError('Motivo do cancelamento é obrigatório.', 400, '');
    }
    return texto;
}

export function avaliarCancelamentoAdminStatus(
    status: string
): CancelamentoAdminStatusResult {
    if (status === StatusReservaHospedagem.Cancelada) {
        return { action: 'idempotent' };
    }

    if (status === StatusReservaHospedagem.Hospedada) {
        throw new CustomError(
            'Reserva hospedada não pode ser cancelada.',
            400,
            ''
        );
    }

    if (status === StatusReservaHospedagem.Expirada) {
        throw new CustomError(
            'Reserva expirada não pode ser cancelada.',
            400,
            ''
        );
    }

    if (status === StatusReservaHospedagem.CheckOutRealizado) {
        throw new CustomError(
            'Reserva com check-out realizado não pode ser cancelada.',
            400,
            ''
        );
    }

    if (
        status === StatusReservaHospedagem.Confirmada ||
        status === StatusReservaHospedagem.AguardandoPagamento
    ) {
        return { action: 'cancel' };
    }

    throw new CustomError(
        `Status ${status} não permite cancelamento administrativo.`,
        400,
        ''
    );
}

export async function cancelarReservaHospedagemAdmin(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    motivo: unknown;
}): Promise<{ id: number; status: string; alreadyCancelled: boolean }> {
    const idReserva = Number(params.idReservaHospedagem);
    const idUsuario = Number(params.idUsuario);

    if (!Number.isFinite(idReserva) || idReserva <= 0) {
        throw new CustomError('id da reserva é obrigatório.', 400, '');
    }
    if (!Number.isFinite(idUsuario) || idUsuario <= 0) {
        throw new CustomError('Usuário não autenticado.', 401, '');
    }

    const reserva = await ReservaHospedagem.findByPk(idReserva);
    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    const status = String(reserva.status || '');
    const avaliacao = avaliarCancelamentoAdminStatus(status);

    if (avaliacao.action === 'idempotent') {
        const { markOutboundCancelled } = await import(
            '../integrations/hospedin/outbound/HospedinOutboundEnqueueService'
        );
        await markOutboundCancelled(idReserva);
        return {
            id: idReserva,
            status: StatusReservaHospedagem.Cancelada,
            alreadyCancelled: true,
        };
    }

    const motivo = validarMotivoCancelamentoAdmin(params.motivo);
    const descricaoHistorico = `Cancelamento administrativo: ${motivo}`;

    await cancelarReservaHospedagem(
        idReserva,
        idUsuario,
        descricaoHistorico
    );

    const atualOperador = String(reserva.observacaoOperador || '').trim();
    const linhaCancelamento = `[Cancelamento] ${motivo}`;
    const observacaoOperador = atualOperador
        ? `${atualOperador}\n\n${linhaCancelamento}`
        : linhaCancelamento;

    await reserva.update({ observacaoOperador });

    return {
        id: idReserva,
        status: StatusReservaHospedagem.Cancelada,
        alreadyCancelled: false,
    };
}
