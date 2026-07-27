import { CustomError } from './customError';
import { formatInTimeZone } from 'date-fns-tz';
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

const TZ_HOSPEDAGEM = 'America/Cuiaba';
const CHECKIN_MIN_MINUTOS = 16 * 60;
const CHECKIN_MAX_MINUTOS = 19 * 60;
const CHECKOUT_MIN_MINUTOS = 8 * 60;
const CHECKOUT_MAX_MINUTOS = 13 * 60;

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
