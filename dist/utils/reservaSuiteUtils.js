"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inicioDoDia = exports.toNumber = exports.roundMoney = exports.calcularTotaisSuitePousada = exports.VALOR_ADICIONAL_CRIANCA_EXTRA = exports.VALOR_ADICIONAL_ADULTO_EXTRA = exports.HORA_CHECKOUT_HOSPEDAGEM = exports.HORA_CHECKIN_HOSPEDAGEM = void 0;
exports.calcularNoitesHotelaria = calcularNoitesHotelaria;
exports.intervalosConflitam = intervalosConflitam;
exports.validarHorarioCheckinHospedagem = validarHorarioCheckinHospedagem;
exports.validarCheckinPosteriorAoAgoraSeHoje = validarCheckinPosteriorAoAgoraSeHoje;
exports.validarHorarioCheckoutHospedagem = validarHorarioCheckoutHospedagem;
exports.parseDateTimeParam = parseDateTimeParam;
exports.parsePositiveInt = parsePositiveInt;
exports.calcularExtrasPousada = calcularExtrasPousada;
const customError_1 = require("./customError");
const date_fns_tz_1 = require("date-fns-tz");
const reservaSuitePricing_1 = require("./reservaSuitePricing");
Object.defineProperty(exports, "inicioDoDia", { enumerable: true, get: function () { return reservaSuitePricing_1.inicioDoDia; } });
/** Horário oficial de check-in da hospedagem (Cuiabá). */
exports.HORA_CHECKIN_HOSPEDAGEM = '16:00';
/** Horário oficial de check-out da hospedagem (Cuiabá). */
exports.HORA_CHECKOUT_HOSPEDAGEM = '13:00';
const TZ_HOSPEDAGEM = 'America/Cuiaba';
const CHECKIN_MIN_MINUTOS = 16 * 60;
const CHECKIN_MAX_MINUTOS = 19 * 60;
const CHECKOUT_MIN_MINUTOS = 8 * 60;
const CHECKOUT_MAX_MINUTOS = 13 * 60;
var reservaSuitePricing_2 = require("./reservaSuitePricing");
Object.defineProperty(exports, "VALOR_ADICIONAL_ADULTO_EXTRA", { enumerable: true, get: function () { return reservaSuitePricing_2.VALOR_ADICIONAL_ADULTO_EXTRA; } });
Object.defineProperty(exports, "VALOR_ADICIONAL_CRIANCA_EXTRA", { enumerable: true, get: function () { return reservaSuitePricing_2.VALOR_ADICIONAL_CRIANCA_EXTRA; } });
Object.defineProperty(exports, "calcularTotaisSuitePousada", { enumerable: true, get: function () { return reservaSuitePricing_2.calcularTotaisSuitePousada; } });
Object.defineProperty(exports, "roundMoney", { enumerable: true, get: function () { return reservaSuitePricing_2.roundMoney; } });
Object.defineProperty(exports, "toNumber", { enumerable: true, get: function () { return reservaSuitePricing_2.toNumber; } });
/**
 * Noites = diferença em dias civis entre check-in e check-out (checkout exclusivo).
 * Ex.: 15/07 16:00 → 17/07 13:00 = 2 noites.
 */
function calcularNoitesHotelaria(checkin, checkout) {
    const noites = (0, reservaSuitePricing_1.calcularNoitesHotelaria)(checkin, checkout);
    if (noites < 1) {
        throw new customError_1.CustomError('Check-out deve ser posterior ao check-in (mínimo 1 noite).', 400, '');
    }
    return noites;
}
/** Conflito de intervalos: inicioA < fimB && fimA > inicioB */
function intervalosConflitam(a, b) {
    return a.inicio.getTime() < b.fim.getTime() && a.fim.getTime() > b.inicio.getTime();
}
function minutosNoFuso(d) {
    const h = Number((0, date_fns_tz_1.formatInTimeZone)(d, TZ_HOSPEDAGEM, 'H'));
    const m = Number((0, date_fns_tz_1.formatInTimeZone)(d, TZ_HOSPEDAGEM, 'm'));
    return h * 60 + m;
}
/** Garante check-in entre 16:00 e 19:00 (fuso Cuiabá). */
function validarHorarioCheckinHospedagem(checkin) {
    const minutos = minutosNoFuso(checkin);
    if (minutos < CHECKIN_MIN_MINUTOS || minutos > CHECKIN_MAX_MINUTOS) {
        throw new customError_1.CustomError('O horário de check-in deve estar entre 16:00 e 19:00.', 400, '');
    }
}
/**
 * Se o check-in for hoje (Cuiabá), o horário deve ser estritamente posterior ao agora.
 */
function validarCheckinPosteriorAoAgoraSeHoje(checkin) {
    const agora = new Date();
    const hojeStr = (0, date_fns_tz_1.formatInTimeZone)(agora, TZ_HOSPEDAGEM, 'yyyy-MM-dd');
    const checkinStr = (0, date_fns_tz_1.formatInTimeZone)(checkin, TZ_HOSPEDAGEM, 'yyyy-MM-dd');
    if (hojeStr !== checkinStr) {
        return;
    }
    if (checkin.getTime() <= agora.getTime()) {
        throw new customError_1.CustomError('O horário de check-in deve ser posterior ao horário atual.', 400, '');
    }
}
/** Garante check-out entre 08:00 e 13:00 (fuso Cuiabá). */
function validarHorarioCheckoutHospedagem(checkout) {
    const minutos = minutosNoFuso(checkout);
    if (minutos < CHECKOUT_MIN_MINUTOS || minutos > CHECKOUT_MAX_MINUTOS) {
        throw new customError_1.CustomError('O horário de check-out deve estar entre 08:00 e 13:00.', 400, '');
    }
}
function parseDateTimeParam(value, fieldName) {
    if (value === undefined || value === null || value === '') {
        throw new customError_1.CustomError(`${fieldName} é obrigatório.`, 400, '');
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new customError_1.CustomError(`${fieldName} inválido.`, 400, '');
    }
    return parsed;
}
function parsePositiveInt(value, fieldName, min = 0) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min) {
        throw new customError_1.CustomError(`${fieldName} inválido.`, 400, '');
    }
    return n;
}
function calcularExtrasPousada(adultos, criancas, qtdeMinimaPessoas, qtdeMaximaPessoas) {
    const extras = (0, reservaSuitePricing_1.calcularExtrasOcupacao)(adultos, criancas, qtdeMinimaPessoas, qtdeMaximaPessoas);
    if (!extras) {
        const total = adultos + criancas;
        const min = qtdeMinimaPessoas ?? 1;
        const max = qtdeMaximaPessoas ?? min;
        if (total > max) {
            throw new customError_1.CustomError(`A suíte permite no máximo ${max} hóspede(s) (informado: ${total}).`, 400, '');
        }
        throw new customError_1.CustomError(`A suíte requer no mínimo ${min} hóspede(s) (informado: ${total}).`, 400, '');
    }
    return extras;
}
