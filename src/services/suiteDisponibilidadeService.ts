/**
 * SuiteDisponibilidadeService — núcleo da matriz oficial de estados.
 *
 * Fonte: docs/HOSPEDAGEM_MATRIZ_ESTADOS_SUITES.md (v1.2)
 *
 * Consumidores:
 * - Parte 3: cards Suítes via `mapearCardSuiteOperacional`.
 * - Parte 4: Nova Reserva / Selecionar Suíte via `calcularDisponibilidadePeriodo`
 *   (`listarSuitesDisponiveis`).
 * - Parte 5: Agenda via `montarCalendarioMes` (`calcularDisponibilidadeSuite` +
 *   `classificarReservaNoDia` para eventos/barras).
 * - Parte 7: Check-in / Check-out sheet via `obterReservaAdminDetalhe.disponibilidade`
 *   (`podeCheckin` / `podeCheckout` só quando `dataSelecionada === hoje`, matriz §7).
 */

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { endOfDay, startOfDay } from 'date-fns';
import {
    intervalosConflitam,
    periodosHospedagemConflitam,
    reservaTemCheckinNaDataCivil,
} from '../utils/reservaSuiteUtils';

export const SUITE_DISPONIBILIDADE_TZ = 'America/Cuiaba';

/** Status de reserva aceitos pelo núcleo (espelho do banco). */
export type StatusReservaDisponibilidade =
    | 'AguardandoPagamento'
    | 'Confirmada'
    | 'Hospedada'
    | 'CheckOutRealizado'
    | 'Cancelada'
    | 'Expirada';

/** Badges oficiais da matriz (§1.4) usados no card do dia. */
export type BadgeSuiteDisponibilidade =
    | 'LIVRE'
    | 'AGUARDANDO_PAGAMENTO'
    | 'CHECKIN_HOJE'
    | 'RESERVADA'
    | 'HOSPEDADA'
    | 'CHECKOUT_HOJE';

export type BotaoPrincipalDisponibilidade =
    | 'nova_reserva'
    | 'checkin'
    | 'checkout'
    | 'ver_reserva'
    | 'nenhum';

/** Relação da reserva com o dia D (§1.1). */
export type RelacaoDiaReserva =
    | 'antes_checkin'
    | 'dia_checkin'
    | 'noite_intermediaria'
    | 'dia_checkout'
    | 'apos_checkout'
    | 'sem_periodo';

export type ReservaDisponibilidadeInput = {
    id: number;
    status: StatusReservaDisponibilidade;
    checkin: Date | string;
    checkout: Date | string;
    dataHoraCheckinReal?: Date | string | null;
    dataHoraCheckoutRealizado?: Date | string | null;
    /** Se > 0, bloqueia podeCheckin (matriz §7). */
    saldoPendente?: number | null;
};

export type SuiteDisponibilidadeInput = {
    idEventoSuite: number;
    /** Data civil yyyy-MM-dd (Cuiabá). */
    dataSelecionada: string;
    reservas: ReservaDisponibilidadeInput[];
    /**
     * “Hoje” civil yyyy-MM-dd (Cuiabá). Default: agora no fuso.
     * Datas `dataSelecionada` &lt; hoje → consulta histórica (sem Nova Reserva).
     */
    hoje?: string;
};

export type SuiteDisponibilidadeResultado = {
    idEventoSuite: number;
    dataSelecionada: string;
    /** Alias alinhado ao vocabulário operacional atual. */
    statusOperacional: BadgeSuiteDisponibilidade;
    badge: BadgeSuiteDisponibilidade;
    badgeLabel: string;
    livre: boolean;
    checkinHoje: boolean;
    checkoutHoje: boolean;
    hospedada: boolean;
    disponivelAposCheckout: boolean;
    /** Há reserva ocupante cujo período cobre o dia D. */
    possuiReservaNaData: boolean;
    /** Há ocupante com check-in na data civil D (bloqueia Livres/Nova Reserva). */
    possuiCheckinNaData: boolean;
    podeReservar: boolean;
    podeCheckin: boolean;
    podeCheckout: boolean;
    apareceEmSuitesLivres: boolean;
    agendaOcupada: boolean;
    mensagem: string | null;
    mensagemSecundaria: string | null;
    botaoPrincipal: BotaoPrincipalDisponibilidade;
    reservaAtual: ReservaDisponibilidadeInput | null;
    proximaReserva: ReservaDisponibilidadeInput | null;
    /** Relação dia↔reservaAtual (útil para testes / UI futura). */
    relacaoReservaAtual: RelacaoDiaReserva | null;
};

type ReservaNorm = {
    raw: ReservaDisponibilidadeInput;
    id: number;
    status: StatusReservaDisponibilidade;
    checkin: Date;
    checkout: Date;
    dataHoraCheckoutRealizado: Date | null;
    saldoPendente: number;
};

const BADGE_LABEL: Record<BadgeSuiteDisponibilidade, string> = {
    LIVRE: 'Livre',
    AGUARDANDO_PAGAMENTO: 'Aguardando pagamento',
    CHECKIN_HOJE: 'Check-in hoje',
    RESERVADA: 'Reservada',
    HOSPEDADA: 'Hospedada',
    CHECKOUT_HOJE: 'Checkout hoje',
};

function asDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
}

function dataCivil(d: Date | string): string {
    return formatInTimeZone(asDate(d), SUITE_DISPONIBILIDADE_TZ, 'yyyy-MM-dd');
}

function boundsDiaCivil(dataYmd: string): { inicio: Date; fim: Date } {
    const [y, m, day] = dataYmd.split('-').map(Number);
    const local = new Date(y, m - 1, day);
    return {
        inicio: fromZonedTime(startOfDay(local), SUITE_DISPONIBILIDADE_TZ),
        fim: fromZonedTime(endOfDay(local), SUITE_DISPONIBILIDADE_TZ),
    };
}

function hojeCivilDefault(): string {
    return formatInTimeZone(new Date(), SUITE_DISPONIBILIDADE_TZ, 'yyyy-MM-dd');
}

function formatHora(d: Date): string {
    return formatInTimeZone(d, SUITE_DISPONIBILIDADE_TZ, 'HH:mm');
}

function formatDataCurta(d: Date): string {
    return formatInTimeZone(d, SUITE_DISPONIBILIDADE_TZ, 'dd/MM');
}

/** Status que ocupam disponibilidade (matriz §1.3). */
function statusOcupa(status: StatusReservaDisponibilidade): boolean {
    return (
        status === 'AguardandoPagamento' ||
        status === 'Confirmada' ||
        status === 'Hospedada'
    );
}

function normalizarReserva(r: ReservaDisponibilidadeInput): ReservaNorm {
    return {
        raw: r,
        id: r.id,
        status: r.status,
        checkin: asDate(r.checkin),
        checkout: asDate(r.checkout),
        dataHoraCheckoutRealizado: r.dataHoraCheckoutRealizado
            ? asDate(r.dataHoraCheckoutRealizado)
            : null,
        saldoPendente: Number(r.saldoPendente ?? 0),
    };
}

/**
 * Relação civil da reserva com o dia D (matriz §1.1).
 * Exportada para testes / consumo futuro pontual.
 */
export function resolverRelacaoDiaReserva(
    reserva: Pick<ReservaDisponibilidadeInput, 'checkin' | 'checkout'>,
    dataSelecionada: string
): RelacaoDiaReserva {
    const ci = dataCivil(reserva.checkin);
    const co = dataCivil(reserva.checkout);
    if (dataSelecionada < ci) return 'antes_checkin';
    if (dataSelecionada === ci) return 'dia_checkin';
    if (dataSelecionada > ci && dataSelecionada < co) return 'noite_intermediaria';
    if (dataSelecionada === co) return 'dia_checkout';
    if (dataSelecionada > co) return 'apos_checkout';
    return 'sem_periodo';
}

/** Período da reserva cobre o dia civil D (overlap data+hora com o dia). */
export function reservaCobreDiaCivil(
    reserva: Pick<ReservaDisponibilidadeInput, 'checkin' | 'checkout'>,
    dataSelecionada: string
): boolean {
    const { inicio, fim } = boundsDiaCivil(dataSelecionada);
    return intervalosConflitam(
        { inicio: asDate(reserva.checkin), fim: asDate(reserva.checkout) },
        { inicio, fim }
    );
}

/**
 * Indica se um período proposto conflita com ocupantes (matriz §4).
 */
export function periodoConflitaComOcupantes(
    novoCheckin: Date,
    novoCheckout: Date,
    reservas: ReservaDisponibilidadeInput[]
): boolean {
    const novo = { inicio: novoCheckin, fim: novoCheckout };
    const dataCi = dataCivil(novoCheckin);

    for (const r of reservas) {
        if (!statusOcupa(r.status)) continue;
        const existente = {
            inicio: asDate(r.checkin),
            fim: asDate(r.checkout),
        };
        if (periodosHospedagemConflitam(novo, existente)) {
            return true;
        }
        if (reservaTemCheckinNaDataCivil(asDate(r.checkin), dataCi)) {
            return true;
        }
    }
    return false;
}

export type DisponibilidadePeriodoInput = {
    idEventoSuite: number;
    checkin: Date | string;
    checkout: Date | string;
    reservas: ReservaDisponibilidadeInput[];
    /** “Hoje” civil (Cuiabá). Default: agora. */
    hoje?: string;
};

export type DisponibilidadePeriodoResultado = {
    idEventoSuite: number;
    checkin: Date;
    checkout: Date;
    /** Única decisão de listagem para Nova Reserva / Selecionar Suíte. */
    podeReservar: boolean;
    /**
     * Estado do card no dia civil do check-in proposto —
     * deve ser consistente com a tela Suítes nesse dia.
     */
    disponibilidadeNoDiaCheckin: SuiteDisponibilidadeResultado;
    conflitoPeriodo: boolean;
};

/**
 * Disponibilidade para um período de estadia (matriz §4 + card no dia do CI).
 * Fonte única para listagem da Nova Reserva (Parte 4).
 *
 * `podeReservar` = card do dia do CI permite reservar
 *                 E não há conflito de intervalo / check-in na data (§4).
 */
export function calcularDisponibilidadePeriodo(
    input: DisponibilidadePeriodoInput
): DisponibilidadePeriodoResultado {
    const checkin = asDate(input.checkin);
    const checkout = asDate(input.checkout);
    const dataCi = dataCivil(checkin);

    const disponibilidadeNoDiaCheckin = calcularDisponibilidadeSuite({
        idEventoSuite: input.idEventoSuite,
        dataSelecionada: dataCi,
        hoje: input.hoje,
        reservas: input.reservas,
    });

    const conflitoPeriodo = periodoConflitaComOcupantes(
        checkin,
        checkout,
        input.reservas
    );

    const podeReservar =
        disponibilidadeNoDiaCheckin.podeReservar && !conflitoPeriodo;

    return {
        idEventoSuite: input.idEventoSuite,
        checkin,
        checkout,
        podeReservar,
        disponibilidadeNoDiaCheckin,
        conflitoPeriodo,
    };
}

type MatchPrioridade = {
    badge: BadgeSuiteDisponibilidade;
    reserva: ReservaNorm;
    relacao: RelacaoDiaReserva;
};

/**
 * Prioridade §1.5 — primeira regra que aplicar vence.
 */
function aplicarPrioridade(
    ocupantes: ReservaNorm[],
    dataSelecionada: string
): MatchPrioridade | null {
    const cobrindo = ocupantes.filter((r) =>
        reservaCobreDiaCivil(r, dataSelecionada)
    );

    // 3 — Hospedada cobrindo D e D ≠ dia do checkout
    const hospedadaMeio = cobrindo.find((r) => {
        if (r.status !== 'Hospedada') return false;
        return dataCivil(r.checkout) !== dataSelecionada;
    });
    if (hospedadaMeio) {
        return {
            badge: 'HOSPEDADA',
            reserva: hospedadaMeio,
            relacao: resolverRelacaoDiaReserva(hospedadaMeio, dataSelecionada),
        };
    }

    // 4 — Checkout em D (Confirmada ou Hospedada), sem CO operacional
    const checkoutHoje = cobrindo.find((r) => {
        if (r.status !== 'Confirmada' && r.status !== 'Hospedada') return false;
        if (r.dataHoraCheckoutRealizado) return false;
        return dataCivil(r.checkout) === dataSelecionada;
    });
    if (checkoutHoje) {
        return {
            badge: 'CHECKOUT_HOJE',
            reserva: checkoutHoje,
            relacao: 'dia_checkout',
        };
    }

    // 5 — Check-in em D (Confirmada, sem ter entrado)
    const checkinHoje = cobrindo.find((r) => {
        if (r.status !== 'Confirmada') return false;
        return dataCivil(r.checkin) === dataSelecionada;
    });
    if (checkinHoje) {
        return {
            badge: 'CHECKIN_HOJE',
            reserva: checkinHoje,
            relacao: 'dia_checkin',
        };
    }

    // 6 — Confirmada noite intermediária
    const reservadaNoite = cobrindo.find((r) => {
        if (r.status !== 'Confirmada') return false;
        const rel = resolverRelacaoDiaReserva(r, dataSelecionada);
        return rel === 'noite_intermediaria';
    });
    if (reservadaNoite) {
        return {
            badge: 'RESERVADA',
            reserva: reservadaNoite,
            relacao: 'noite_intermediaria',
        };
    }

    // 7 — AguardandoPagamento cobrindo D
    const aguardando = cobrindo.find((r) => r.status === 'AguardandoPagamento');
    if (aguardando) {
        return {
            badge: 'AGUARDANDO_PAGAMENTO',
            reserva: aguardando,
            relacao: resolverRelacaoDiaReserva(aguardando, dataSelecionada),
        };
    }

    // Nenhum ocupante cobrindo D → Livre (§1.5 #8 / §3.1).
    // Reserva futura (CI após D) não muda o badge do dia; vai em `proximaReserva`.
    // Relação `antes_checkin` / badge Reservada: só via `classificarReservaNoDia` (§3.3B).
    return null;
}

function montarMensagens(
    badge: BadgeSuiteDisponibilidade,
    reserva: ReservaNorm | null,
    disponivelAposCheckout: boolean,
    consultaHistorica: boolean
): { mensagem: string | null; mensagemSecundaria: string | null } {
    if (consultaHistorica && badge === 'LIVRE') {
        return { mensagem: 'Consulta histórica', mensagemSecundaria: null };
    }
    if (!reserva || badge === 'LIVRE') {
        return {
            mensagem: 'Disponível para reserva',
            mensagemSecundaria: null,
        };
    }

    const horaCi = formatHora(reserva.checkin);
    const horaCo = formatHora(reserva.checkout);
    const dataCo = formatDataCurta(reserva.checkout);
    const dataCi = formatDataCurta(reserva.checkin);

    switch (badge) {
        case 'CHECKIN_HOJE':
            return {
                mensagem: `Entrada prevista às ${horaCi}`,
                mensagemSecundaria: null,
            };
        case 'CHECKOUT_HOJE':
            return {
                mensagem: `Sai às ${horaCo}`,
                mensagemSecundaria: disponivelAposCheckout
                    ? 'Disponível após o check-out'
                    : 'Nova reserva indisponível: já há entrada nesta data',
            };
        case 'HOSPEDADA': {
            const real = reserva.raw.dataHoraCheckinReal
                ? asDate(reserva.raw.dataHoraCheckinReal)
                : null;
            return {
                mensagem: real
                    ? `Entrou às ${formatHora(real)}`
                    : 'Hóspede no estabelecimento',
                mensagemSecundaria: `Sai em ${dataCo} às ${horaCo}`,
            };
        }
        case 'RESERVADA':
            return {
                mensagem: `Reservada · saída em ${dataCo} às ${horaCo}`,
                mensagemSecundaria: `Entrada em ${dataCi} às ${horaCi}`,
            };
        case 'AGUARDANDO_PAGAMENTO':
            return {
                mensagem: `Aguardando pagamento · entrada prevista às ${horaCi}`,
                mensagemSecundaria: null,
            };
        default:
            return { mensagem: null, mensagemSecundaria: null };
    }
}

function botaoPrincipalDe(
    badge: BadgeSuiteDisponibilidade,
    podeReservar: boolean,
    podeCheckin: boolean,
    podeCheckout: boolean,
    temReserva: boolean
): BotaoPrincipalDisponibilidade {
    if (podeCheckin) return 'checkin';
    if (podeCheckout) return 'checkout';
    if (podeReservar) return 'nova_reserva';
    if (temReserva) return 'ver_reserva';
    return 'nenhum';
}

/**
 * Calcula o estado operacional completo da suíte no dia civil selecionado.
 * Única API pública principal do núcleo (Parte 2).
 */
export function calcularDisponibilidadeSuite(
    input: SuiteDisponibilidadeInput
): SuiteDisponibilidadeResultado {
    const dataSelecionada = input.dataSelecionada;
    const hoje = input.hoje ?? hojeCivilDefault();
    const consultaHistorica = dataSelecionada < hoje;

    const todas = input.reservas.map(normalizarReserva);
    const ocupantes = todas.filter((r) => statusOcupa(r.status));

    const possuiCheckinNaData = ocupantes.some((r) =>
        reservaTemCheckinNaDataCivil(r.checkin, dataSelecionada)
    );
    const possuiReservaNaData = ocupantes.some((r) =>
        reservaCobreDiaCivil(r, dataSelecionada)
    );

    const match = aplicarPrioridade(ocupantes, dataSelecionada);
    const badge: BadgeSuiteDisponibilidade = match?.badge ?? 'LIVRE';
    const reservaAtual = match?.reserva ?? null;
    const relacaoReservaAtual = match?.relacao ?? null;

    const proxima = ocupantes
        .filter((r) => dataCivil(r.checkin) > dataSelecionada)
        .sort(
            (a, b) => a.checkin.getTime() - b.checkin.getTime()
        )[0];

    const checkoutHoje = badge === 'CHECKOUT_HOJE';
    const checkinHoje = badge === 'CHECKIN_HOJE';
    const hospedada = badge === 'HOSPEDADA';
    const livre = badge === 'LIVRE';

    const disponivelAposCheckout = checkoutHoje && !possuiCheckinNaData;

    const podeReservar =
        !consultaHistorica &&
        (livre || disponivelAposCheckout);

    const apareceEmSuitesLivres = podeReservar;

    /**
     * Ações operacionais (matriz §7) — só no dia corrente (`D === hoje`).
     * Check-in: Confirmada, D ≥ dia do CI, saldo ok; negado no dia do CO sem entrada.
     * Badge de noite intermediária permanece Reservada (não vira Check-in hoje).
     */
    const dataCi = reservaAtual ? dataCivil(reservaAtual.checkin) : null;
    const confirmadaSemEntradaNoCheckout =
        Boolean(reservaAtual) &&
        reservaAtual!.status === 'Confirmada' &&
        checkoutHoje;

    const podeCheckin = Boolean(
        reservaAtual &&
            reservaAtual.status === 'Confirmada' &&
            dataSelecionada === hoje &&
            dataCi != null &&
            dataCi <= dataSelecionada &&
            !confirmadaSemEntradaNoCheckout &&
            reservaAtual.saldoPendente <= 0.009
    );

    const podeCheckout = Boolean(
        reservaAtual &&
            reservaAtual.status === 'Hospedada' &&
            dataSelecionada === hoje &&
            (badge === 'HOSPEDADA' || badge === 'CHECKOUT_HOJE')
    );

    const agendaOcupada =
        badge === 'CHECKIN_HOJE' ||
        badge === 'HOSPEDADA' ||
        badge === 'CHECKOUT_HOJE' ||
        badge === 'RESERVADA' ||
        badge === 'AGUARDANDO_PAGAMENTO';

    let mensagens = montarMensagens(
        badge,
        reservaAtual,
        disponivelAposCheckout,
        consultaHistorica
    );

    if (badge === 'RESERVADA' && reservaAtual) {
        const rel = resolverRelacaoDiaReserva(reservaAtual, dataSelecionada);
        if (rel === 'antes_checkin') {
            mensagens = {
                mensagem: `Entrada em ${formatDataCurta(reservaAtual.checkin)} às ${formatHora(reservaAtual.checkin)}`,
                mensagemSecundaria: null,
            };
        } else if (rel === 'noite_intermediaria') {
            mensagens = {
                mensagem: `Reservada · saída em ${formatDataCurta(reservaAtual.checkout)} às ${formatHora(reservaAtual.checkout)}`,
                mensagemSecundaria: null,
            };
        }
    }

    if (badge === 'AGUARDANDO_PAGAMENTO' && reservaAtual) {
        const rel = resolverRelacaoDiaReserva(reservaAtual, dataSelecionada);
        if (rel === 'dia_checkout') {
            mensagens = {
                mensagem: `Aguardando pagamento · saída prevista às ${formatHora(reservaAtual.checkout)}`,
                mensagemSecundaria: null,
            };
        } else if (rel === 'noite_intermediaria') {
            mensagens = {
                mensagem: 'Aguardando pagamento',
                mensagemSecundaria: null,
            };
        }
    }

    return {
        idEventoSuite: input.idEventoSuite,
        dataSelecionada,
        statusOperacional: badge,
        badge,
        badgeLabel: BADGE_LABEL[badge],
        livre,
        checkinHoje,
        checkoutHoje,
        hospedada,
        disponivelAposCheckout,
        possuiReservaNaData,
        possuiCheckinNaData,
        podeReservar,
        podeCheckin,
        podeCheckout,
        apareceEmSuitesLivres,
        agendaOcupada,
        mensagem: mensagens.mensagem,
        mensagemSecundaria: mensagens.mensagemSecundaria,
        botaoPrincipal: botaoPrincipalDe(
            badge,
            podeReservar,
            podeCheckin,
            podeCheckout,
            Boolean(reservaAtual)
        ),
        reservaAtual: reservaAtual?.raw ?? null,
        proximaReserva: proxima?.raw ?? null,
        relacaoReservaAtual,
    };
}

/**
 * Classifica uma única reserva em relação ao dia D (matriz §3.3B).
 * Não substitui o badge do card do dia quando o período não cobre D (§3.1 / §3.3A).
 */
export function classificarReservaNoDia(
    reserva: ReservaDisponibilidadeInput,
    dataSelecionada: string
): {
    badge: BadgeSuiteDisponibilidade;
    relacao: RelacaoDiaReserva;
    agendaOcupada: boolean;
} {
    if (
        reserva.status === 'Cancelada' ||
        reserva.status === 'Expirada' ||
        reserva.status === 'CheckOutRealizado'
    ) {
        return { badge: 'LIVRE', relacao: 'apos_checkout', agendaOcupada: false };
    }

    const rel = resolverRelacaoDiaReserva(reserva, dataSelecionada);

    if (reserva.status === 'Hospedada') {
        if (rel === 'dia_checkout') {
            return { badge: 'CHECKOUT_HOJE', relacao: rel, agendaOcupada: true };
        }
        if (
            rel === 'dia_checkin' ||
            rel === 'noite_intermediaria'
        ) {
            return { badge: 'HOSPEDADA', relacao: rel, agendaOcupada: true };
        }
        return { badge: 'LIVRE', relacao: rel, agendaOcupada: false };
    }

    if (reserva.status === 'Confirmada') {
        if (rel === 'antes_checkin') {
            return { badge: 'RESERVADA', relacao: rel, agendaOcupada: false };
        }
        if (rel === 'dia_checkin') {
            return { badge: 'CHECKIN_HOJE', relacao: rel, agendaOcupada: true };
        }
        if (rel === 'noite_intermediaria') {
            return { badge: 'RESERVADA', relacao: rel, agendaOcupada: true };
        }
        if (rel === 'dia_checkout') {
            return { badge: 'CHECKOUT_HOJE', relacao: rel, agendaOcupada: true };
        }
        return { badge: 'LIVRE', relacao: rel, agendaOcupada: false };
    }

    if (reserva.status === 'AguardandoPagamento') {
        if (
            rel === 'dia_checkin' ||
            rel === 'noite_intermediaria' ||
            rel === 'dia_checkout'
        ) {
            return {
                badge: 'AGUARDANDO_PAGAMENTO',
                relacao: rel,
                agendaOcupada: true,
            };
        }
        return { badge: 'LIVRE', relacao: rel, agendaOcupada: false };
    }

    return { badge: 'LIVRE', relacao: rel, agendaOcupada: false };
}
