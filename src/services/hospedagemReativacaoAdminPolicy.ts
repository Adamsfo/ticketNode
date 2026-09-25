import { formatInTimeZone } from 'date-fns-tz';
import { StatusReservaHospedagem } from '../models/ReservaHospedagem';
import { HospedinOutboundStatus } from '../models/HospedinOutboundSyncState';
import { Transacao } from '../models/Transacao';
import { isOriginEligibleForOutbound } from '../integrations/hospedin/outbound/hospedinOutboundOrigin';
import {
    calcularExpiraEmLinkPagamento,
    calcularExpiraEmReservaOnline,
} from './reservaHospedagemExpiracaoUtils';

const TZ = 'America/Cuiaba';

export type ReativacaoPrazoPagamento = {
    gerarNovoToken: boolean;
    expiraEm: Date;
};

export type AvaliacaoOutboundReativacao =
    | { ok: true; deveMarkDirty: boolean }
    | { ok: false; message: string };

export function avaliarStatusReativacao(
    status: string
): { ok: true } | { ok: false; message: string; statusCode: number } {
    if (status === StatusReservaHospedagem.AguardandoPagamento) {
        return {
            ok: false,
            message: 'Esta reserva já está aguardando pagamento.',
            statusCode: 400,
        };
    }

    if (status !== StatusReservaHospedagem.Expirada) {
        return {
            ok: false,
            message: 'Somente reservas expiradas podem ser reativadas.',
            statusCode: 400,
        };
    }

    return { ok: true };
}

export function resolverPrazoReativacao(input: {
    origemReserva?: string | null;
    tokenPagamento?: string | null;
    linkPagamentoEnviadoEm?: Date | string | null;
    agora?: Date;
}): ReativacaoPrazoPagamento {
    const agora = input.agora ?? new Date();
    const eraFluxoLink =
        Boolean(String(input.tokenPagamento || '').trim()) ||
        Boolean(input.linkPagamentoEnviadoEm);

    if (eraFluxoLink) {
        return {
            gerarNovoToken: true,
            expiraEm: calcularExpiraEmLinkPagamento(agora),
        };
    }

    return {
        gerarNovoToken: false,
        expiraEm: calcularExpiraEmReservaOnline(agora),
    };
}

export function avaliarTransacaoReativacao(
    transacao: Pick<Transacao, 'status'> | null | undefined
): { ok: true } | { ok: false; message: string } {
    if (!transacao) {
        return { ok: true };
    }

    const status = String(transacao.status || '').trim();
    if (status === 'Aguardando pagamento') {
        return { ok: true };
    }

    return {
        ok: false,
        message: `A transação vinculada está em status "${status}" e não pode ser reutilizada para reativação. Analise manualmente antes de prosseguir.`,
    };
}

export function avaliarOutboundReativacao(input: {
    origemReserva?: string | null;
    eventoTipo?: string | null;
    idExterno?: string | null;
    outboundState?: {
        outbound_status: string;
        desired_action: string;
        last_error: string | null;
        error_code?: string | null;
        hospedin_reservation_id?: string | null;
    } | null;
    suites: Array<{ hospedinReservationId?: string | null }>;
}): AvaliacaoOutboundReativacao {
    const hospedagemLike = {
        origemReserva: input.origemReserva ?? null,
        Evento: { tipo: input.eventoTipo ?? 'Pousada' },
    };

    if (!isOriginEligibleForOutbound(hospedagemLike)) {
        return { ok: true, deveMarkDirty: false };
    }

    const suites = input.suites ?? [];
    const comVinculo = suites.filter((s) =>
        Boolean(String(s.hospedinReservationId || '').trim())
    );
    const semVinculo = suites.filter(
        (s) => !String(s.hospedinReservationId || '').trim()
    );

    if (suites.length > 1 && comVinculo.length > 0 && semVinculo.length > 0) {
        return {
            ok: false,
            message:
                'A reserva possui vínculo parcial com o Hospedin. Reative manualmente após revisar a sincronização.',
        };
    }

    const idExterno = String(input.idExterno || '').trim();
    const queueId = String(
        input.outboundState?.hospedin_reservation_id || ''
    ).trim();

    if (
        input.outboundState?.outbound_status === HospedinOutboundStatus.ABORTED
    ) {
        const abortCode = String(
            input.outboundState.error_code || ''
        ).trim();
        if (abortCode !== 'STATUS_TERMINAL') {
            return {
                ok: false,
                message:
                    'A sincronização outbound desta reserva está abortada. Revise o Hospedin antes de reativar.',
            };
        }
    }

    if (
        suites.length > 1 &&
        !idExterno &&
        !queueId &&
        comVinculo.length === 0 &&
        input.outboundState?.outbound_status === HospedinOutboundStatus.FAILED &&
        String(input.outboundState.last_error || '').includes('STATUS_TERMINAL')
    ) {
        return {
            ok: false,
            message:
                'A fila outbound falhou permanentemente para esta reserva multi-suíte. Revise o Hospedin antes de reativar.',
        };
    }

    return { ok: true, deveMarkDirty: true };
}

export function formatarPeriodoConflitoReativacao(
    checkin: Date,
    checkout: Date
): string {
    const inicioData = formatInTimeZone(checkin, TZ, 'dd/MM/yyyy');
    const inicioHora = formatInTimeZone(checkin, TZ, 'HH:mm');
    const fimData = formatInTimeZone(checkout, TZ, 'dd/MM/yyyy');
    const fimHora = formatInTimeZone(checkout, TZ, 'HH:mm');
    return `${inicioData} às ${inicioHora} até ${fimData} às ${fimHora}`;
}

export function montarMensagemConflitoReativacao(
    suitesIndisponiveis: Array<{ nomeSuite: string }>,
    periodoFormatado: string
): string {
    const linhas = suitesIndisponiveis.map(
        (suite) =>
            `A ${suite.nomeSuite} não está mais disponível para o período ${periodoFormatado}.`
    );

    const detalhe =
        linhas.length === 1
            ? linhas[0]
            : linhas.map((linha) => `- ${linha}`).join('\n');

    return `Não foi possível reativar a reserva.\n\n${detalhe}\n\nA reserva permanece expirada.`;
}
