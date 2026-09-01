/**
 * Merge e split de observações da reserva (importada Hospedin + operador Jango).
 */

export type ReservaObservacoesPartes = {
    observacaoImportada: string | null;
    observacaoOperador: string | null;
};

/** Texto único exibido na UI — preserva quebras de linha. */
export function mergeReservaObservacoes(
    importada?: string | null,
    operador?: string | null
): string {
    const imp = importada ?? '';
    const op = operador ?? '';
    if (!imp && !op) return '';
    if (!imp) return op;
    if (!op) return imp;
    if (op.startsWith(imp)) return op;
    return `${imp}\n\n${op}`;
}

/**
 * Extrai partes a partir do texto editado pelo operador.
 * Preserva espaçamento do trecho operacional; não faz trim do texto completo.
 */
export function splitOperadorFromTextoCompleto(
    textoCompleto: string,
    importada?: string | null
): ReservaObservacoesPartes {
    const imp = importada ?? '';

    if (!imp) {
        return {
            observacaoImportada: null,
            observacaoOperador: textoCompleto.length ? textoCompleto : null,
        };
    }

    if (!textoCompleto.length) {
        return { observacaoImportada: null, observacaoOperador: null };
    }

    if (textoCompleto === imp) {
        return { observacaoImportada: imp, observacaoOperador: null };
    }

    if (textoCompleto.startsWith(imp)) {
        let rest = textoCompleto.slice(imp.length);
        rest = rest.replace(/^\r?\n\r?\n?/, '');
        if (!rest.length) {
            return { observacaoImportada: imp, observacaoOperador: null };
        }
        return { observacaoImportada: imp, observacaoOperador: rest };
    }

    // Operador reescreveu o bloco visível — anotação passa a ser o texto inteiro.
    return {
        observacaoImportada: null,
        observacaoOperador: textoCompleto,
    };
}

/** Campos iniciais ao criar reserva conforme origem. */
export function buildObservacoesFieldsForCreate(input: {
    origemIntegracao: boolean;
    observacoes?: string | null;
}): ReservaObservacoesPartes & { observacoes: string | null } {
    const texto = input.observacoes ?? '';
    const trimmed = texto.trim();
    if (!trimmed) {
        return {
            observacaoImportada: null,
            observacaoOperador: null,
            observacoes: null,
        };
    }

    if (input.origemIntegracao) {
        return {
            observacaoImportada: texto,
            observacaoOperador: null,
            observacoes: mergeReservaObservacoes(texto, null) || null,
        };
    }

    return {
        observacaoImportada: null,
        observacaoOperador: texto,
        observacoes: texto,
    };
}

/** Atualiza somente a parte importada (sync Hospedin), preservando operador. */
export function applyObservacaoImportadaUpdate(
    novaImportada: string | null,
    operadorAtual?: string | null
): ReservaObservacoesPartes & { observacoes: string | null } {
    const importada = novaImportada ?? null;
    const operador = operadorAtual ?? null;
    return {
        observacaoImportada: importada,
        observacaoOperador: operador,
        observacoes: mergeReservaObservacoes(importada, operador) || null,
    };
}
