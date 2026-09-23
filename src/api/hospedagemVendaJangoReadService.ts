import apiJango from './apiJango';

/** STATUS da tabela VENDA no Jango PDV (referência operacional). */
export const VendaJangoStatus = {
    Aberto: 0,
    Fechado: 1,
    Cancelado: 2,
    Reservado: 3,
    Agenda: 4,
} as const;

export type VendaHospedagemJango = {
    idVenda: number;
    status: number;
    dataHora: string | null;
    idCliente: number | null;
    totalVenda: number | null;
    valorRecebido: number | null;
    valorAReceber: number | null;
    suite: string | null;
};

export type ConsultaVendaHospedagemResult =
    | { ok: true; venda: VendaHospedagemJango }
    | {
          ok: false;
          motivo: 'ID_INVALIDO' | 'NAO_ENCONTRADA' | 'ERRO_COMUNICACAO';
      };

function lerCampo<T>(
    row: Record<string, unknown>,
    ...keys: string[]
): T | undefined {
    for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null) {
            return row[key] as T;
        }
    }
    return undefined;
}

export function normalizarVendaHospedagemJango(
    row: Record<string, unknown>
): VendaHospedagemJango {
    const idVenda = Number(
        lerCampo(row, 'id_venda', 'ID_VENDA') ?? 0
    );
    const statusRaw = lerCampo(row, 'status', 'STATUS');
    const status =
        statusRaw === undefined || statusRaw === null
            ? NaN
            : Number(statusRaw);

    const dataHoraRaw = lerCampo(row, 'data_hora', 'DATA_HORA');
    const suiteRaw = lerCampo(row, 'suite', 'SUITE');

    return {
        idVenda,
        status,
        dataHora:
            dataHoraRaw != null && dataHoraRaw !== ''
                ? String(dataHoraRaw)
                : null,
        idCliente: (() => {
            const n = Number(lerCampo(row, 'id_cliente', 'ID_CLIENTE'));
            return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        totalVenda: (() => {
            const n = Number(lerCampo(row, 'total_venda', 'TOTAL_VENDA'));
            return Number.isFinite(n) ? n : null;
        })(),
        valorRecebido: (() => {
            const n = Number(
                lerCampo(row, 'valor_recebido', 'VALOR_RECEBIDO')
            );
            return Number.isFinite(n) ? n : null;
        })(),
        valorAReceber: (() => {
            const n = Number(
                lerCampo(row, 'valor_a_receber', 'VALOR_A_RECEBER')
            );
            return Number.isFinite(n) ? n : null;
        })(),
        suite:
            suiteRaw != null && String(suiteRaw).trim()
                ? String(suiteRaw).trim()
                : null,
    };
}

/**
 * Consulta read-only da venda PDV vinculada à hospedagem (ReservaHospedagem.idVendaJango).
 */
export async function consultarVendaHospedagemPorId(
    idVenda: number
): Promise<ConsultaVendaHospedagemResult> {
    const idVendaNum = Number(idVenda);
    if (!Number.isFinite(idVendaNum) || idVendaNum <= 0) {
        return { ok: false, motivo: 'ID_INVALIDO' };
    }

    const rows = await apiJango().consultarVendaHospedagemPorId(idVendaNum);
    if (rows === null) {
        return { ok: false, motivo: 'ERRO_COMUNICACAO' };
    }
    if (!rows.length) {
        return { ok: false, motivo: 'NAO_ENCONTRADA' };
    }

    const venda = normalizarVendaHospedagemJango(rows[0]);
    if (!Number.isFinite(venda.idVenda) || venda.idVenda <= 0) {
        return { ok: false, motivo: 'ERRO_COMUNICACAO' };
    }

    return { ok: true, venda };
}
