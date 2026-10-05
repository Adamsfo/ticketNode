/**
 * Critério de caixa aberto no PDV Jango (Firebird / CAIXA).
 * O dia comercial do caixa segue DATA_ABERTURA = CURRENT_DATE no Firebird (mesmo padrão de getCaixa legacy).
 * Aberto: DATA_FECHAMENTO ausente; STATUS não indica fechamento explícito quando preenchido.
 */

export type CaixaPdvRegistro = {
    idCaixa: number;
    dataAbertura: Date | string | null;
    dataFechamento: Date | string | null;
    status: string | null;
};

function valorVazio(data: unknown): boolean {
    if (data === null || data === undefined) {
        return true;
    }
    if (typeof data === 'string' && data.trim() === '') {
        return true;
    }
    return false;
}

/** Status que indicam caixa fechado no legado (quando a coluna é usada). */
const STATUS_FECHADO = new Set(['F', 'FECHADO', 'FECHADA', 'C', 'CLOSED']);

/**
 * Espelha o critério SQL `DATA_FECHAMENTO IS NULL` com validação defensiva em memória.
 */
export function isCaixaPdvAberto(registro: {
    dataFechamento?: unknown;
    status?: unknown;
}): boolean {
    if (!valorVazio(registro.dataFechamento)) {
        return false;
    }
    const status = String(registro.status ?? '')
        .trim()
        .toUpperCase();
    if (status && STATUS_FECHADO.has(status)) {
        return false;
    }
    return true;
}

export function escolherCaixaAbertoPreferido(
    caixas: CaixaPdvRegistro[]
): CaixaPdvRegistro | null {
    const abertos = caixas.filter((c) =>
        isCaixaPdvAberto({
            dataFechamento: c.dataFechamento,
            status: c.status,
        })
    );
    if (abertos.length === 0) {
        return null;
    }
    return abertos.reduce((melhor, atual) =>
        atual.idCaixa > melhor.idCaixa ? atual : melhor
    );
}
