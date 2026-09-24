import { CustomError } from '../utils/customError';

export const VERSAO_POLITICA_HOSPEDAGEM = '2026-09-v1';

const MSG_ACEITE_OBRIGATORIO =
    'É necessário aceitar a Política de Cancelamento, Remarcação e Alteração de Hóspedes.';

/**
 * Checkout autenticado em POST /reservasuite/checkout:
 * cliente no site reserva para si (idUsuario === usuário do JWT).
 * PDV/recepção na pousada informam o id do hóspede, diferente do operador logado.
 * Não confiar em flag enviada pelo cliente no body.
 */
export function ehContratacaoClienteCheckoutSite(
    idUsuarioReserva: number,
    idUsuarioAutenticado: number | undefined | null
): boolean {
    const idReserva = Number(idUsuarioReserva);
    const idAuth = Number(idUsuarioAutenticado);
    if (!(idReserva > 0) || !(idAuth > 0)) {
        return false;
    }
    return idReserva === idAuth;
}

/**
 * Aceite obrigatório somente quando o próprio cliente contrata pelo site
 * (`contratacaoCliente === true`, inferido no servidor). PDV não se enquadra.
 */
export function exigirAceitePoliticaCheckoutCliente(
    contratacaoCliente: boolean,
    aceitePoliticaHospedagem: unknown
): void {
    if (!contratacaoCliente) {
        return;
    }
    if (aceitePoliticaHospedagem !== true) {
        throw new CustomError(MSG_ACEITE_OBRIGATORIO, 400, '');
    }
}

export function camposAceitePoliticaParaCreateCliente(
    contratacaoCliente: boolean,
    aceitePoliticaHospedagem: unknown,
    agora: Date
) {
    if (!contratacaoCliente || aceitePoliticaHospedagem !== true) {
        return {};
    }
    return {
        aceitePoliticaHospedagem: true,
        dataAceitePoliticaHospedagem: agora,
        versaoPoliticaHospedagem: VERSAO_POLITICA_HOSPEDAGEM,
    };
}

export function exigirAceitePoliticaReservaPublica(body: unknown): void {
    const aceite = (body as { aceitePoliticaHospedagem?: unknown })
        ?.aceitePoliticaHospedagem;
    if (aceite !== true) {
        throw new CustomError(MSG_ACEITE_OBRIGATORIO, 400, '');
    }
}

export function camposAceitePoliticaParaUpdateLink(
    agora: Date,
    jaAceito: boolean
): {
    aceitePoliticaHospedagem: boolean;
    dataAceitePoliticaHospedagem: Date;
    versaoPoliticaHospedagem: string;
} | Record<string, never> {
    if (jaAceito) {
        return {};
    }
    return {
        aceitePoliticaHospedagem: true,
        dataAceitePoliticaHospedagem: agora,
        versaoPoliticaHospedagem: VERSAO_POLITICA_HOSPEDAGEM,
    };
}
