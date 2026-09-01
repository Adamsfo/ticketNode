/**
 * Detecção operacional de indícios de pagamento via OTA no texto `note`.
 * Não quita reserva e não lança pagamento — apenas indicador.
 */

export type DeteccaoPagamentoOta = {
    matched: boolean;
    trecho: string | null;
    padroes: string[];
};

/** Padrões que indicam cobrança/pagamento pela plataforma (não pelo hotel). */
const PADROES_OTA: Array<{ id: string; re: RegExp }> = [
    {
        id: 'PRE_PAID',
        re: /THIS\s+RESERVATION\s+HAS\s+BEEN\s+PRE-?PAID/i,
    },
    { id: 'PREPAID', re: /\bPrepaid\b/i },
    { id: 'EXPEDIA_COLLECT', re: /Expedia\s*Collect/i },
    {
        id: 'HOTEL_CHARGES_VCC',
        re: /Hotel\s+charges\s+virtual\s+card/i,
    },
    { id: 'VIRTUAL_CARD', re: /Virtual\s+Card/i },
    { id: 'VCC', re: /\bVCC\b/i },
    {
        id: 'EXPEDIA_COLLECTS_TRAVELER',
        re: /Expedia\s+collects\s+payment\s+from\s+traveler/i,
    },
    { id: 'PAYMENT_INSTRUCTION', re: /Payment\s+Instruction/i },
    {
        id: 'COLLECTS_FROM_TRAVELER',
        re: /Collects\s+payment\s+from\s+traveler/i,
    },
];

/** Hotel Collect puro: hóspede paga no hotel — não é “pagamento via OTA”. */
const PADROES_HOTEL_COLLECT: RegExp[] = [
    /Hotel\s*Collect/i,
    /Hotel\s+collects\s+payment\s+from\s+(the\s+)?traveler/i,
    /Collect\s+Payment\s+From\s+Guest/i,
];

const PADROES_OTA_FORTES = new Set([
    'PRE_PAID',
    'PREPAID',
    'EXPEDIA_COLLECT',
    'HOTEL_CHARGES_VCC',
    'VIRTUAL_CARD',
    'VCC',
    'EXPEDIA_COLLECTS_TRAVELER',
]);

function isHotelCollectOnly(note: string, padroes: string[]): boolean {
    const hasHotel = PADROES_HOTEL_COLLECT.some((re) => re.test(note));
    if (!hasHotel) return false;
    return !padroes.some((id) => PADROES_OTA_FORTES.has(id));
}

function extrairTrecho(note: string, matchIndex: number, matchLen: number): string {
    const start = Math.max(0, note.lastIndexOf('\n', matchIndex - 1) + 1);
    let end = note.indexOf('\n', matchIndex + matchLen);
    if (end < 0) end = note.length;
    // Inclui até 2 linhas seguintes (Payment Instruction costuma ter 2–3 linhas).
    for (let i = 0; i < 2; i++) {
        const next = note.indexOf('\n', end + 1);
        if (next < 0) {
            end = note.length;
            break;
        }
        end = next;
    }
    const trecho = note.slice(start, end).trim();
    if (trecho.length <= 420) return trecho;
    return `${trecho.slice(0, 417).trim()}...`;
}

/**
 * Analisa o campo note (Hospedin/OTA) em busca de indícios de pagamento pela plataforma.
 */
export function detectPossivelPagamentoOta(
    note: string | null | undefined
): DeteccaoPagamentoOta {
    const text = String(note || '').trim();
    if (!text) {
        return { matched: false, trecho: null, padroes: [] };
    }

    const padroes: string[] = [];
    let firstMatch: { index: number; length: number } | null = null;

    for (const p of PADROES_OTA) {
        const m = p.re.exec(text);
        if (!m || m.index == null) continue;
        padroes.push(p.id);
        if (!firstMatch || m.index < firstMatch.index) {
            firstMatch = { index: m.index, length: m[0].length };
        }
    }

    if (!padroes.length || !firstMatch) {
        return { matched: false, trecho: null, padroes: [] };
    }

    if (isHotelCollectOnly(text, padroes)) {
        return { matched: false, trecho: null, padroes: [] };
    }

    return {
        matched: true,
        trecho: extrairTrecho(text, firstMatch.index, firstMatch.length),
        padroes,
    };
}

export function labelCanalVendaOta(
    canalVenda: string | null | undefined
): string {
    const raw = String(canalVenda || '').trim();
    if (!raw) return '—';
    const n = raw
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
    if (n.includes('BOOKING')) return 'Booking';
    if (n.includes('EXPEDIA') || n.includes('HOTELS.COM') || n === 'HOTELS_COM') {
        return 'Expedia';
    }
    if (n.includes('AIRBNB')) return 'Airbnb';
    if (n.includes('DECOLAR') || n.includes('DESPEGAR')) return 'Decolar';
    return raw;
}
