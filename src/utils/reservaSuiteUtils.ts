import { CustomError } from './customError';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import {
    calcularExtrasOcupacao,
    calcularNoitesHotelaria as calcularNoitesHotelariaCore,
    inicioDoDia,
} from './reservaSuitePricing';

export type IntervaloDateTime = { inicio: Date; fim: Date };

/** Horário oficial de check-in da hospedagem (Cuiabá). */
export const HORA_CHECKIN_HOSPEDAGEM = '16:00';
/** Horário oficial de check-out da hospedagem (Cuiabá). */
export const HORA_CHECKOUT_HOSPEDAGEM = '13:00';

export const TZ_HOSPEDAGEM = 'America/Cuiaba';
const CHECKIN_MIN_MINUTOS = 16 * 60;
const CHECKIN_MAX_MINUTOS = 19 * 60;
const CHECKOUT_MIN_MINUTOS = 8 * 60;
const CHECKOUT_MAX_MINUTOS = 13 * 60;

const RE_DATA_CIVIL = /^(\d{4}-\d{2}-\d{2})/;
const RE_SOMENTE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_TEM_RELOGIO = /T\d{2}:\d{2}| \d{2}:\d{2}/;

export type TipoHorarioHospedagem = 'checkin' | 'checkout';

export type NormalizarDateTimeHospedagemOpts = {
    /**
     * Força data civil + horário padrão do PMS (ex.: mapeamento Hospedin → Jango).
     * Ignora qualquer horário presente no valor de origem.
     */
    forcarHorarioPadrao?: boolean;
    /** Origem da reserva (ex.: HOSPEDIN) — usada para tratar placeholders da integração. */
    origemReserva?: string | null;
};

/**
 * Extrai a data civil (yyyy-MM-dd) no fuso da hospedagem.
 * Em strings ISO, usa o prefixo yyyy-MM-dd do payload (evita dia errado
 * quando a integração manda offset diferente de America/Cuiaba).
 */
export function dataCivilHospedagem(value: Date | string): string {
    if (typeof value === 'string') {
        const s = value.trim();
        const m = s.match(RE_DATA_CIVIL);
        if (m) return m[1];
        const parsed = new Date(s);
        if (!Number.isNaN(parsed.getTime())) {
            return formatInTimeZone(parsed, TZ_HOSPEDAGEM, 'yyyy-MM-dd');
        }
    }
    const d = value instanceof Date ? value : new Date(value);
    return formatInTimeZone(d, TZ_HOSPEDAGEM, 'yyyy-MM-dd');
}

/** True quando o valor bruto traz componente de horário (não só a data). */
export function valorInformaHorarioHospedagem(value: unknown): boolean {
    if (value == null || value === '') return false;
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return false;
        return (
            formatInTimeZone(value, TZ_HOSPEDAGEM, 'HH:mm:ss') !== '00:00:00'
        );
    }
    const s = String(value).trim();
    if (!s || RE_SOMENTE_DATA.test(s)) return false;
    if (!RE_TEM_RELOGIO.test(s)) return false;
    const parsed = new Date(s);
    if (Number.isNaN(parsed.getTime())) return false;
    return formatInTimeZone(parsed, TZ_HOSPEDAGEM, 'HH:mm:ss') !== '00:00:00';
}

/**
 * Combina data civil + horário padrão oficial do PMS (Cuiabá).
 * Único ponto para montar 16:00 / 13:00 a partir de uma data.
 */
export function montarDateTimeComHorarioPadraoHospedagem(
    value: Date | string,
    tipo: TipoHorarioHospedagem
): Date {
    const dia = dataCivilHospedagem(value);
    const hora =
        tipo === 'checkin'
            ? HORA_CHECKIN_HOSPEDAGEM
            : HORA_CHECKOUT_HOSPEDAGEM;
    return fromZonedTime(`${dia} ${hora}:00`, TZ_HOSPEDAGEM);
}

/**
 * Normaliza check-in/check-out para o PMS.
 *
 * - Nulo/vazio → null
 * - Sem horário (ausente, só data, 00:00) → horário padrão do PMS
 * - Origem HOSPEDIN ou `forcarHorarioPadrao` → data civil + padrão
 *   (a Hospedin não envia horário operacional da pousada)
 * - Horário realmente informado (outras origens) → preservado
 */
export function normalizarDateTimeHospedagem(
    value: unknown,
    tipo: TipoHorarioHospedagem,
    opts?: NormalizarDateTimeHospedagemOpts
): Date | null {
    if (value == null || value === '') return null;

    const origem = String(opts?.origemReserva || '').toUpperCase();
    const forcar =
        Boolean(opts?.forcarHorarioPadrao) || origem === 'HOSPEDIN';

    const asWallDate = (): Date | string | null => {
        if (typeof value === 'string' || value instanceof Date) return value;
        const parsed = new Date(value as string | number | Date);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    if (forcar) {
        const wall = asWallDate();
        return wall
            ? montarDateTimeComHorarioPadraoHospedagem(wall, tipo)
            : null;
    }

    if (!valorInformaHorarioHospedagem(value)) {
        const wall = asWallDate();
        return wall
            ? montarDateTimeComHorarioPadraoHospedagem(wall, tipo)
            : null;
    }

    const parsed =
        value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

/** Normaliza o par check-in/check-out com a mesma regra. */
export function normalizarPeriodoHospedagem(
    checkin: unknown,
    checkout: unknown,
    opts?: NormalizarDateTimeHospedagemOpts
): { checkin: Date | null; checkout: Date | null } {
    return {
        checkin: normalizarDateTimeHospedagem(checkin, 'checkin', opts),
        checkout: normalizarDateTimeHospedagem(checkout, 'checkout', opts),
    };
}

export {
    VALOR_ADICIONAL_ADULTO_EXTRA,
    VALOR_ADICIONAL_CRIANCA_EXTRA,
    calcularTotaisSuitePousada,
    roundMoney,
    toNumber,
} from './reservaSuitePricing';

/** Normaliza para comparação de dia civil (regra hotelaria). */
export { inicioDoDia };

/**
 * Noites = diferença em dias civis entre check-in e check-out (checkout exclusivo).
 * Ex.: 15/07 16:00 → 17/07 13:00 = 2 noites.
 */
export function calcularNoitesHotelaria(checkin: Date, checkout: Date): number {
    const noites = calcularNoitesHotelariaCore(checkin, checkout);

    if (noites < 1) {
        throw new CustomError(
            'Check-out deve ser posterior ao check-in (mínimo 1 noite).',
            400,
            ''
        );
    }

    return noites;
}

/**
 * Única regra de sobreposição de hospedagem (data + horário).
 *
 * Intervalos semiabertos [inicio, fim): o instante de check-out libera a suíte.
 * Ex.: checkout existente 27/07 13:00 → novo check-in 13:00 ou depois = sem conflito;
 *      novo check-in 12:59 = conflito.
 *
 * Usar em: lista de disponibilidade, validação de checkout e ocupação operacional
 * (card/agenda) — não duplicar comparação só por data civil.
 */
export function intervalosConflitam(
    a: IntervaloDateTime,
    b: IntervaloDateTime
): boolean {
    return (
        a.inicio.getTime() < b.fim.getTime() &&
        a.fim.getTime() > b.inicio.getTime()
    );
}

/** Alias semântico: disponibilidade de suíte no período solicitado. */
export function periodosHospedagemConflitam(
    periodoA: IntervaloDateTime,
    periodoB: IntervaloDateTime
): boolean {
    return intervalosConflitam(periodoA, periodoB);
}

/**
 * Disponibilidade para nova reserva na data civil (Cuiabá) — sem horário.
 * Se já existe reserva com check-in na mesma data, a suíte fica indisponível.
 * Usar em: cards Suítes + listarSuitesDisponiveis (mesma regra).
 */
export function reservaTemCheckinNaDataCivil(
    checkinReserva: Date,
    dataReferencia: Date | string
): boolean {
    const dataStr =
        typeof dataReferencia === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(dataReferencia)
            ? dataReferencia
            : formatInTimeZone(
                  dataReferencia instanceof Date
                      ? dataReferencia
                      : new Date(dataReferencia),
                  TZ_HOSPEDAGEM,
                  'yyyy-MM-dd'
              );
    const checkinStr = formatInTimeZone(
        checkinReserva instanceof Date
            ? checkinReserva
            : new Date(checkinReserva),
        TZ_HOSPEDAGEM,
        'yyyy-MM-dd'
    );
    return checkinStr === dataStr;
}

/** True se alguma reserva ocupante tem check-in na data civil informada. */
export function suiteIndisponivelPorCheckinNaData(
    checkinsOcupantes: Array<Date | string>,
    dataReferencia: Date | string
): boolean {
    return checkinsOcupantes.some((checkin) =>
        reservaTemCheckinNaDataCivil(
            checkin instanceof Date ? checkin : new Date(checkin),
            dataReferencia
        )
    );
}

function minutosNoFuso(d: Date): number {
    const h = Number(formatInTimeZone(d, TZ_HOSPEDAGEM, 'H'));
    const m = Number(formatInTimeZone(d, TZ_HOSPEDAGEM, 'm'));
    return h * 60 + m;
}

/** Garante check-in entre 16:00 e 19:00 (fuso Cuiabá). */
export function validarHorarioCheckinHospedagem(checkin: Date): void {
    const minutos = minutosNoFuso(checkin);
    if (minutos < CHECKIN_MIN_MINUTOS || minutos > CHECKIN_MAX_MINUTOS) {
        throw new CustomError(
            'O horário de check-in deve estar entre 16:00 e 19:00.',
            400,
            ''
        );
    }
}

/**
 * Se o check-in for hoje (Cuiabá), o horário deve ser estritamente posterior ao agora.
 */
export function validarCheckinPosteriorAoAgoraSeHoje(checkin: Date): void {
    const agora = new Date();
    const hojeStr = formatInTimeZone(agora, TZ_HOSPEDAGEM, 'yyyy-MM-dd');
    const checkinStr = formatInTimeZone(checkin, TZ_HOSPEDAGEM, 'yyyy-MM-dd');
    if (hojeStr !== checkinStr) {
        return;
    }
    if (checkin.getTime() <= agora.getTime()) {
        throw new CustomError(
            'O horário de check-in deve ser posterior ao horário atual.',
            400,
            ''
        );
    }
}

/** Impede criar reserva com check-in em dia anterior ao atual (fuso Cuiabá). */
export function validarCheckinNaoEmDataPassada(checkin: Date): void {
    const agora = new Date();
    const hojeStr = formatInTimeZone(agora, TZ_HOSPEDAGEM, 'yyyy-MM-dd');
    const checkinStr = formatInTimeZone(checkin, TZ_HOSPEDAGEM, 'yyyy-MM-dd');
    if (checkinStr < hojeStr) {
        throw new CustomError(
            'Não é permitido criar reservas para datas passadas.',
            400,
            ''
        );
    }
}

/** Garante check-out entre 08:00 e 13:00 (fuso Cuiabá). */
export function validarHorarioCheckoutHospedagem(checkout: Date): void {
    const minutos = minutosNoFuso(checkout);
    if (minutos < CHECKOUT_MIN_MINUTOS || minutos > CHECKOUT_MAX_MINUTOS) {
        throw new CustomError(
            'O horário de check-out deve estar entre 08:00 e 13:00.',
            400,
            ''
        );
    }
}

export function parseDateTimeParam(value: unknown, fieldName: string): Date {
    if (value === undefined || value === null || value === '') {
        throw new CustomError(`${fieldName} é obrigatório.`, 400, '');
    }

    const parsed = new Date(value as string | number | Date);
    if (Number.isNaN(parsed.getTime())) {
        throw new CustomError(`${fieldName} inválido.`, 400, '');
    }

    return parsed;
}

export function parsePositiveInt(value: unknown, fieldName: string, min = 0): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min) {
        throw new CustomError(`${fieldName} inválido.`, 400, '');
    }
    return n;
}

/**
 * Valida apenas o teto de ocupação.
 * Uso em troca administrativa de suíte: mínimo não bloqueia, máximo continua.
 */
export function validarCapacidadeMaximaPousada(
    adultos: number,
    criancas: number,
    qtdeMaximaPessoas?: number | null,
    qtdeMinimaPessoas?: number | null
): void {
    const total = adultos + criancas;
    const min = qtdeMinimaPessoas ?? 1;
    const max = qtdeMaximaPessoas ?? min;

    if (total > max) {
        throw new CustomError(
            `A suíte permite no máximo ${max} hóspede(s) (informado: ${total}).`,
            400,
            ''
        );
    }
}

export function calcularExtrasPousada(
    adultos: number,
    criancas: number,
    qtdeMinimaPessoas?: number | null,
    qtdeMaximaPessoas?: number | null
) {
    const extras = calcularExtrasOcupacao(
        adultos,
        criancas,
        qtdeMinimaPessoas,
        qtdeMaximaPessoas
    );

    if (!extras) {
        const total = adultos + criancas;
        const min = qtdeMinimaPessoas ?? 1;
        const max = qtdeMaximaPessoas ?? min;

        if (total > max) {
            throw new CustomError(
                `A suíte permite no máximo ${max} hóspede(s) (informado: ${total}).`,
                400,
                ''
            );
        }

        throw new CustomError(
            `A suíte requer no mínimo ${min} hóspede(s) (informado: ${total}).`,
            400,
            ''
        );
    }

    return extras;
}
