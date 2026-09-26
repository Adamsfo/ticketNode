/** Link externo /reserva/:token (recepção → enviar para cliente). */
export const MINUTOS_EXPIRACAO_LINK_PAGAMENTO = 30;

/** Expiração legada do checkout online (CLIENTE/SITE) quando expiraEm está nulo. */
export const MINUTOS_EXPIRACAO_RESERVA_ONLINE = 15;

const ORIGENS_RESERVA_CLIENTE_ONLINE = ['CLIENTE', 'SITE'] as const;

export type ReservaHospedagemExpiracaoInput = {
    status: string;
    expiraEm?: Date | string | null;
    origemReserva?: string | null;
    tokenPagamento?: string | null;
    createdAt?: Date | string | null;
};

/**
 * Mesmos critérios de `cancelarReservasExpiradas()` para uma única reserva
 * em AguardandoPagamento (sem UPDATE).
 */
export function estaReservaHospedagemAguardandoPagamentoVencida(
    hospedagem: ReservaHospedagemExpiracaoInput,
    agora: Date = new Date()
): boolean {
    if (hospedagem.status !== 'AguardandoPagamento') {
        return false;
    }

    if (hospedagem.expiraEm != null && hospedagem.expiraEm !== '') {
        return new Date(hospedagem.expiraEm).getTime() < agora.getTime();
    }

    const createdAt = new Date(hospedagem.createdAt ?? agora);
    const limiteLegacy = new Date(
        agora.getTime() - MINUTOS_EXPIRACAO_RESERVA_ONLINE * 60 * 1000
    );
    const limiteLink = new Date(
        agora.getTime() - MINUTOS_EXPIRACAO_LINK_PAGAMENTO * 60 * 1000
    );

    const origem = String(hospedagem.origemReserva || '').toUpperCase();
    if (
        (ORIGENS_RESERVA_CLIENTE_ONLINE as readonly string[]).includes(origem)
    ) {
        if (createdAt.getTime() < limiteLegacy.getTime()) {
            return true;
        }
    }

    if (hospedagem.tokenPagamento) {
        if (createdAt.getTime() < limiteLink.getTime()) {
            return true;
        }
    }

    return false;
}

export function calcularExpiraEmLinkPagamento(desde: Date = new Date()): Date {
    return new Date(
        desde.getTime() + MINUTOS_EXPIRACAO_LINK_PAGAMENTO * 60 * 1000
    );
}

/** Prazo explícito para reserva online (CLIENTE) aguardando pagamento. */
export function calcularExpiraEmReservaOnline(desde: Date = new Date()): Date {
    return new Date(
        desde.getTime() + MINUTOS_EXPIRACAO_RESERVA_ONLINE * 60 * 1000
    );
}
