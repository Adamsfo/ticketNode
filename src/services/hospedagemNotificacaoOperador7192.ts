import { enviarMensagemTextoZApi } from '../utils/zApiWhatsApp';
import type { HospedagemConfirmacaoConteudo } from './hospedagemConfirmacaoNotificacao';

/** Operador recepção elegível para notificação adicional (criador da reserva). */
export const ID_USUARIO_CRIACAO_NOTIFICACAO_OPERADOR_7192 = 7192;

/** Destino fixo da notificação adicional (WhatsApp). */
export const TELEFONE_NOTIFICACAO_OPERADOR_7192 = '65984791202';

export function isReservaElegivelNotificacaoOperador7192(params: {
    origemReserva?: string | null;
    idUsuarioCriacao?: number | null;
}): boolean {
    const origem = String(params.origemReserva ?? '')
        .trim()
        .toUpperCase();
    if (origem !== 'ATENDENTE') {
        return false;
    }
    return Number(params.idUsuarioCriacao) === ID_USUARIO_CRIACAO_NOTIFICACAO_OPERADOR_7192;
}

function formatarSuitesResumo(
    suites: HospedagemConfirmacaoConteudo['suites']
): string {
    if (!suites.length) {
        return '—';
    }
    if (suites.length === 1) {
        return suites[0].nome;
    }
    return suites.map((suite) => suite.nome).join(', ');
}

export function montarMensagemWhatsAppConfirmacaoOperador7192(
    conteudo: HospedagemConfirmacaoConteudo
): string {
    const suite = formatarSuitesResumo(conteudo.suites);
    return `🏨 Reserva confirmada

A reserva do cliente ${conteudo.nomeCliente} foi confirmada.

Reserva: #${conteudo.idReserva}
Check-in: ${conteudo.dataEntrada}
Check-out: ${conteudo.dataSaida}
Suíte: ${suite}`;
}

export function montarMensagemWhatsAppExpiracaoOperador7192(
    conteudo: HospedagemConfirmacaoConteudo
): string {
    const suite = formatarSuitesResumo(conteudo.suites);
    return `🏨 Reserva expirada

A reserva do cliente ${conteudo.nomeCliente} expirou e foi cancelada.

Reserva: #${conteudo.idReserva}
Check-in: ${conteudo.dataEntrada}
Check-out: ${conteudo.dataSaida}
Suíte: ${suite}`;
}

export async function enviarWhatsAppNotificacaoOperador7192SeElegivel(
    params: {
        idReservaHospedagem: number;
        conteudo: HospedagemConfirmacaoConteudo;
        origemReserva?: string | null;
        idUsuarioCriacao?: number | null;
        tipo: 'confirmacao' | 'expiracao';
    }
): Promise<void> {
    if (
        !isReservaElegivelNotificacaoOperador7192({
            origemReserva: params.origemReserva,
            idUsuarioCriacao: params.idUsuarioCriacao,
        })
    ) {
        return;
    }

    const mensagem =
        params.tipo === 'confirmacao'
            ? montarMensagemWhatsAppConfirmacaoOperador7192(params.conteudo)
            : montarMensagemWhatsAppExpiracaoOperador7192(params.conteudo);

    try {
        await enviarMensagemTextoZApi(
            TELEFONE_NOTIFICACAO_OPERADOR_7192,
            mensagem
        );
    } catch (error) {
        console.error(
            `Erro ao enviar WhatsApp adicional (operador 7192) da reserva ${params.idReservaHospedagem} (${params.tipo}):`,
            error
        );
    }
}
