"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inicioDoDia = exports.toNumber = exports.roundMoney = exports.calcularTotaisSuitePousada = exports.VALOR_ADICIONAL_CRIANCA_EXTRA = exports.VALOR_ADICIONAL_ADULTO_EXTRA = exports.TZ_HOSPEDAGEM = exports.HORA_CHECKOUT_HOSPEDAGEM = exports.HORA_CHECKIN_HOSPEDAGEM = void 0;
exports.dataCivilHospedagem = dataCivilHospedagem;
exports.valorInformaHorarioHospedagem = valorInformaHorarioHospedagem;
exports.montarDateTimeComHorarioPadraoHospedagem = montarDateTimeComHorarioPadraoHospedagem;
exports.normalizarDateTimeHospedagem = normalizarDateTimeHospedagem;
exports.normalizarPeriodoHospedagem = normalizarPeriodoHospedagem;
exports.calcularNoitesHotelaria = calcularNoitesHotelaria;
exports.intervalosConflitam = intervalosConflitam;
exports.periodosHospedagemConflitam = periodosHospedagemConflitam;
exports.reservaTemCheckinNaDataCivil = reservaTemCheckinNaDataCivil;
exports.suiteIndisponivelPorCheckinNaData = suiteIndisponivelPorCheckinNaData;
exports.validarHorarioCheckinHospedagem = validarHorarioCheckinHospedagem;
exports.validarCheckinPosteriorAoAgoraSeHoje = validarCheckinPosteriorAoAgoraSeHoje;
exports.validarCheckinNaoEmDataPassada = validarCheckinNaoEmDataPassada;
exports.validarHorarioCheckoutHospedagem = validarHorarioCheckoutHospedagem;
exports.parseDateTimeParam = parseDateTimeParam;
exports.parsePositiveInt = parsePositiveInt;
exports.validarCapacidadeMaximaPousada = validarCapacidadeMaximaPousada;
exports.calcularExtrasPousada = calcularExtrasPousada;
const customError_1 = require("./customError");
const date_fns_tz_1 = require("date-fns-tz");
const reservaSuitePricing_1 = require("./reservaSuitePricing");
Object.defineProperty(exports, "inicioDoDia", { enumerable: true, get: function () { return reservaSuitePricing_1.inicioDoDia; } });
/** Horário oficial de check-in da hospedagem (Cuiabá). */
exports.HORA_CHECKIN_HOSPEDAGEM = '16:00';
/** Horário oficial de check-out da hospedagem (Cuiabá). */
exports.HORA_CHECKOUT_HOSPEDAGEM = '13:00';
exports.TZ_HOSPEDAGEM = 'America/Cuiaba';
const CHECKIN_MIN_MINUTOS = 16 * 60;
const CHECKIN_MAX_MINUTOS = 19 * 60;
const CHECKOUT_MIN_MINUTOS = 8 * 60;
const CHECKOUT_MAX_MINUTOS = 13 * 60;
const RE_DATA_CIVIL = /^(\d{4}-\d{2}-\d{2})/;
const RE_SOMENTE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_TEM_RELOGIO = /T\d{2}:\d{2}| \d{2}:\d{2}/;
/**
 * Extrai a data civil (yyyy-MM-dd) no fuso da hospedagem.
 * Em strings ISO, usa o prefixo yyyy-MM-dd do payload (evita dia errado
 * quando a integração manda offset diferente de America/Cuiaba).
 */
function dataCivilHospedagem(value) {
    if (typeof value === 'string') {
        const s = value.trim();
        const m = s.match(RE_DATA_CIVIL);
        if (m)
            return m[1];
        const parsed = new Date(s);
        if (!Number.isNaN(parsed.getTime())) {
            return (0, date_fns_tz_1.formatInTimeZone)(parsed, exports.TZ_HOSPEDAGEM, 'yyyy-MM-dd');
        }
    }
    const d = value instanceof Date ? value : new Date(value);
    return (0, date_fns_tz_1.formatInTimeZone)(d, exports.TZ_HOSPEDAGEM, 'yyyy-MM-dd');
}
/** True quando o valor bruto traz componente de horário (não só a data). */
function valorInformaHorarioHospedagem(value) {
    if (value == null || value === '')
        return false;
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime()))
            return false;
        return ((0, date_fns_tz_1.formatInTimeZone)(value, exports.TZ_HOSPEDAGEM, 'HH:mm:ss') !== '00:00:00');
    }
    const s = String(value).trim();
    if (!s || RE_SOMENTE_DATA.test(s))
        return false;
    if (!RE_TEM_RELOGIO.test(s))
        return false;
    const parsed = new Date(s);
    if (Number.isNaN(parsed.getTime()))
        return false;
    return (0, date_fns_tz_1.formatInTimeZone)(parsed, exports.TZ_HOSPEDAGEM, 'HH:mm:ss') !== '00:00:00';
}
/**
 * Combina data civil + horário padrão oficial do PMS (Cuiabá).
 * Único ponto para montar 16:00 / 13:00 a partir de uma data.
 */
function montarDateTimeComHorarioPadraoHospedagem(value, tipo) {
    const dia = dataCivilHospedagem(value);
    const hora = tipo === 'checkin'
        ? exports.HORA_CHECKIN_HOSPEDAGEM
        : exports.HORA_CHECKOUT_HOSPEDAGEM;
    return (0, date_fns_tz_1.fromZonedTime)(`${dia} ${hora}:00`, exports.TZ_HOSPEDAGEM);
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
function normalizarDateTimeHospedagem(value, tipo, opts) {
    if (value == null || value === '')
        return null;
    const origem = String(opts?.origemReserva || '').toUpperCase();
    const forcar = Boolean(opts?.forcarHorarioPadrao) || origem === 'HOSPEDIN';
    const asWallDate = () => {
        if (typeof value === 'string' || value instanceof Date)
            return value;
        const parsed = new Date(value);
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
    const parsed = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(parsed.getTime()))
        return null;
    return parsed;
}
/** Normaliza o par check-in/check-out com a mesma regra. */
function normalizarPeriodoHospedagem(checkin, checkout, opts) {
    return {
        checkin: normalizarDateTimeHospedagem(checkin, 'checkin', opts),
        checkout: normalizarDateTimeHospedagem(checkout, 'checkout', opts),
    };
}
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
function intervalosConflitam(a, b) {
    return (a.inicio.getTime() < b.fim.getTime() &&
        a.fim.getTime() > b.inicio.getTime());
}
/** Alias semântico: disponibilidade de suíte no período solicitado. */
function periodosHospedagemConflitam(periodoA, periodoB) {
    return intervalosConflitam(periodoA, periodoB);
}
/**
 * Disponibilidade para nova reserva na data civil (Cuiabá) — sem horário.
 * Se já existe reserva com check-in na mesma data, a suíte fica indisponível.
 * Usar em: cards Suítes + listarSuitesDisponiveis (mesma regra).
 */
function reservaTemCheckinNaDataCivil(checkinReserva, dataReferencia) {
    const dataStr = typeof dataReferencia === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(dataReferencia)
        ? dataReferencia
        : (0, date_fns_tz_1.formatInTimeZone)(dataReferencia instanceof Date
            ? dataReferencia
            : new Date(dataReferencia), exports.TZ_HOSPEDAGEM, 'yyyy-MM-dd');
    const checkinStr = (0, date_fns_tz_1.formatInTimeZone)(checkinReserva instanceof Date
        ? checkinReserva
        : new Date(checkinReserva), exports.TZ_HOSPEDAGEM, 'yyyy-MM-dd');
    return checkinStr === dataStr;
}
/** True se alguma reserva ocupante tem check-in na data civil informada. */
function suiteIndisponivelPorCheckinNaData(checkinsOcupantes, dataReferencia) {
    return checkinsOcupantes.some((checkin) => reservaTemCheckinNaDataCivil(checkin instanceof Date ? checkin : new Date(checkin), dataReferencia));
}
function minutosNoFuso(d) {
    const h = Number((0, date_fns_tz_1.formatInTimeZone)(d, exports.TZ_HOSPEDAGEM, 'H'));
    const m = Number((0, date_fns_tz_1.formatInTimeZone)(d, exports.TZ_HOSPEDAGEM, 'm'));
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
    const hojeStr = (0, date_fns_tz_1.formatInTimeZone)(agora, exports.TZ_HOSPEDAGEM, 'yyyy-MM-dd');
    const checkinStr = (0, date_fns_tz_1.formatInTimeZone)(checkin, exports.TZ_HOSPEDAGEM, 'yyyy-MM-dd');
    if (hojeStr !== checkinStr) {
        return;
    }
    if (checkin.getTime() <= agora.getTime()) {
        throw new customError_1.CustomError('O horário de check-in deve ser posterior ao horário atual.', 400, '');
    }
}
/** Impede criar reserva com check-in em dia anterior ao atual (fuso Cuiabá). */
function validarCheckinNaoEmDataPassada(checkin) {
    const agora = new Date();
    const hojeStr = (0, date_fns_tz_1.formatInTimeZone)(agora, exports.TZ_HOSPEDAGEM, 'yyyy-MM-dd');
    const checkinStr = (0, date_fns_tz_1.formatInTimeZone)(checkin, exports.TZ_HOSPEDAGEM, 'yyyy-MM-dd');
    if (checkinStr < hojeStr) {
        throw new customError_1.CustomError('Não é permitido criar reservas para datas passadas.', 400, '');
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
/**
 * Valida apenas o teto de ocupação.
 * Uso em troca administrativa de suíte: mínimo não bloqueia, máximo continua.
 */
function validarCapacidadeMaximaPousada(adultos, criancas, qtdeMaximaPessoas, qtdeMinimaPessoas) {
    const total = adultos + criancas;
    const min = qtdeMinimaPessoas ?? 1;
    const max = qtdeMaximaPessoas ?? min;
    if (total > max) {
        throw new customError_1.CustomError(`A suíte permite no máximo ${max} hóspede(s) (informado: ${total}).`, 400, '');
    }
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
