import { CustomError } from './customError';
import {
    calcularExtrasOcupacao,
    calcularNoitesHotelaria as calcularNoitesHotelariaCore,
    inicioDoDia,
} from './reservaSuitePricing';

export type IntervaloDateTime = { inicio: Date; fim: Date };

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
 * Ex.: 15/07 14:00 → 17/07 11:00 = 2 noites.
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

/** Conflito de intervalos: inicioA < fimB && fimA > inicioB */
export function intervalosConflitam(a: IntervaloDateTime, b: IntervaloDateTime): boolean {
    return a.inicio.getTime() < b.fim.getTime() && a.fim.getTime() > b.inicio.getTime();
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
