/**
 * Testes — detecção operacional de pagamento via OTA no note.
 * node -r ts-node/register/transpile-only src/utils/detectPossivelPagamentoOta.test.ts
 */
import {
    detectPossivelPagamentoOta,
    labelCanalVendaOta,
} from './detectPossivelPagamentoOta';

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

const booking = detectPossivelPagamentoOta(
    'ja foi paga via booking\n** THIS RESERVATION HAS BEEN PRE-PAID **\nDouble Room'
);
assert(booking.matched, 'Booking PRE-PAID deve marcar');
assert(
    (booking.trecho || '').toUpperCase().includes('PRE-PAID'),
    'trecho Booking'
);

const expedia = detectPossivelPagamentoOta(
    'pessoa ja pagou pela expedia\nPayment Instruction: Expedia collects payment from traveler: Hotel charges virtual card.\n(ExpediaCollect)'
);
assert(expedia.matched, 'Expedia Collect + VCC deve marcar');
assert(
    (expedia.trecho || '').toLowerCase().includes('payment instruction') ||
        (expedia.trecho || '').toLowerCase().includes('virtual'),
    'trecho Expedia'
);

const hotelCollect = detectPossivelPagamentoOta(
    'Hotel Collect Booking  Collect Payment From Guest.\nPayment Instruction: Hotel collects payment from the traveler\n(HotelCollect)'
);
assert(!hotelCollect.matched, 'Hotel Collect puro NÃO deve marcar OTA');

const vazio = detectPossivelPagamentoOta('');
assert(!vazio.matched, 'note vazio');

assert(labelCanalVendaOta('BOOKING') === 'Booking', 'label Booking');
assert(labelCanalVendaOta('EXPEDIA') === 'Expedia', 'label Expedia');

console.log('detectPossivelPagamentoOta.test OK');
