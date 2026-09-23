import { StatusReservaHospedagem } from '../models/ReservaHospedagem';
import { VendaJangoStatus } from '../api/hospedagemVendaJangoReadService';

/** Margem após o checkout previsto antes de considerar a reserva (evita corrida com checkout manual). */
export const MARGEM_SEGURANCA_CHECKOUT_AUTOMATICO_MS = 30 * 60 * 1000;

export const TIMEZONE_CHECKOUT_AUTOMATICO = 'America/Cuiaba';

export const HORA_CHECKOUT_AUTOMATICO = 2;

export type AcaoCheckoutAutomaticoPdv =
    | 'EXECUTAR_CHECKOUT'
    | 'IGNORAR_CONTA_ABERTA'
    | 'IGNORAR_VENDA_CANCELADA'
    | 'IGNORAR_STATUS_INESPERADO'
    | 'IGNORAR_VENDA_INEXISTENTE'
    | 'IGNORAR_ERRO_PDV';

export function idVendaJangoValido(valor: number | null | undefined): boolean {
    const n = Number(valor);
    return Number.isFinite(n) && n > 0;
}

export function calcularLimiteCheckoutComMargem(agora: Date = new Date()): Date {
    return new Date(agora.getTime() - MARGEM_SEGURANCA_CHECKOUT_AUTOMATICO_MS);
}

export function reservaElegivelCheckoutAutomatico(input: {
    status: string;
    checkout: Date | string;
    idVendaJango?: number | null;
    agora?: Date;
}): boolean {
    if (input.status !== StatusReservaHospedagem.Hospedada) {
        return false;
    }
    if (!idVendaJangoValido(input.idVendaJango)) {
        return false;
    }

    const checkout =
        input.checkout instanceof Date
            ? input.checkout
            : new Date(input.checkout);
    if (Number.isNaN(checkout.getTime())) {
        return false;
    }

    const limite = calcularLimiteCheckoutComMargem(input.agora ?? new Date());
    return checkout.getTime() <= limite.getTime();
}

export function avaliarStatusVendaCheckoutAutomatico(
    status: number
): { acao: AcaoCheckoutAutomaticoPdv; executarCheckout: boolean } {
    if (!Number.isFinite(status)) {
        return {
            acao: 'IGNORAR_STATUS_INESPERADO',
            executarCheckout: false,
        };
    }

    if (status === VendaJangoStatus.Aberto) {
        return {
            acao: 'IGNORAR_CONTA_ABERTA',
            executarCheckout: false,
        };
    }

    if (status === VendaJangoStatus.Fechado) {
        return {
            acao: 'EXECUTAR_CHECKOUT',
            executarCheckout: true,
        };
    }

    if (status === VendaJangoStatus.Cancelado) {
        return {
            acao: 'IGNORAR_VENDA_CANCELADA',
            executarCheckout: false,
        };
    }

    if (
        status === VendaJangoStatus.Reservado ||
        status === VendaJangoStatus.Agenda
    ) {
        return {
            acao: 'IGNORAR_STATUS_INESPERADO',
            executarCheckout: false,
        };
    }

    return {
        acao: 'IGNORAR_STATUS_INESPERADO',
        executarCheckout: false,
    };
}

export function mapearMotivoConsultaPdv(
    motivo: 'ID_INVALIDO' | 'NAO_ENCONTRADA' | 'ERRO_COMUNICACAO'
): AcaoCheckoutAutomaticoPdv {
    if (motivo === 'NAO_ENCONTRADA' || motivo === 'ID_INVALIDO') {
        return 'IGNORAR_VENDA_INEXISTENTE';
    }
    return 'IGNORAR_ERRO_PDV';
}
