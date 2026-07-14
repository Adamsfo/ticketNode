"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inicioDoDia = exports.toNumber = exports.roundMoney = exports.calcularTotaisSuitePousada = exports.VALOR_ADICIONAL_CRIANCA_EXTRA = exports.VALOR_ADICIONAL_ADULTO_EXTRA = void 0;
exports.calcularNoitesHotelaria = calcularNoitesHotelaria;
exports.intervalosConflitam = intervalosConflitam;
exports.parseDateTimeParam = parseDateTimeParam;
exports.parsePositiveInt = parsePositiveInt;
exports.calcularExtrasPousada = calcularExtrasPousada;
const customError_1 = require("./customError");
const reservaSuitePricing_1 = require("./reservaSuitePricing");
Object.defineProperty(exports, "inicioDoDia", { enumerable: true, get: function () { return reservaSuitePricing_1.inicioDoDia; } });
var reservaSuitePricing_2 = require("./reservaSuitePricing");
Object.defineProperty(exports, "VALOR_ADICIONAL_ADULTO_EXTRA", { enumerable: true, get: function () { return reservaSuitePricing_2.VALOR_ADICIONAL_ADULTO_EXTRA; } });
Object.defineProperty(exports, "VALOR_ADICIONAL_CRIANCA_EXTRA", { enumerable: true, get: function () { return reservaSuitePricing_2.VALOR_ADICIONAL_CRIANCA_EXTRA; } });
Object.defineProperty(exports, "calcularTotaisSuitePousada", { enumerable: true, get: function () { return reservaSuitePricing_2.calcularTotaisSuitePousada; } });
Object.defineProperty(exports, "roundMoney", { enumerable: true, get: function () { return reservaSuitePricing_2.roundMoney; } });
Object.defineProperty(exports, "toNumber", { enumerable: true, get: function () { return reservaSuitePricing_2.toNumber; } });
/**
 * Noites = diferença em dias civis entre check-in e check-out (checkout exclusivo).
 * Ex.: 15/07 14:00 → 17/07 11:00 = 2 noites.
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
