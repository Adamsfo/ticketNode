import { assessCpf, type CpfAssessment } from './cpf';

export type GuestDocumentLike = {
    tipo?: string | null;
    numero?: string | null;
};

export type GuestCpfSourceInput = {
    /** Campos explícitos de CPF no payload. */
    cpf?: unknown;
    ssn?: unknown;
    documento?: unknown;
    /** Documentos Hospedin — usar como CPF somente se válidos. */
    identification?: unknown;
    document?: unknown;
    passport?: unknown;
    documents?: GuestDocumentLike[] | null;
};

export type GuestCpfPickResult = {
    /** Valor a passar ao GuestResolver (formatado se válido; raw se inválido explícito). */
    cpf: string | null;
    /** De onde veio o CPF válido (ou null). */
    source: string | null;
    assessment: CpfAssessment;
};

/**
 * Extrai o melhor CPF do payload + documentos importados.
 *
 * Regra:
 * 1) Preferir qualquer CPF *válido* entre campos e documentos.
 * 2) Só cair em "inválido" se cpf/ssn explícitos existirem e forem inválidos
 *    (RG/passaporte em identification NÃO contam como CPF inválido).
 * 3) Sem documento válido → missing (HÓSPEDE SEM CPF).
 */
export function pickGuestCpf(input: GuestCpfSourceInput): GuestCpfPickResult {
    const candidates: Array<{ source: string; raw: unknown }> = [];

    if (input.cpf != null && String(input.cpf).trim() !== '') {
        candidates.push({ source: 'cpf', raw: input.cpf });
    }
    if (input.ssn != null && String(input.ssn).trim() !== '') {
        candidates.push({ source: 'ssn', raw: input.ssn });
    }
    if (input.documento != null && String(input.documento).trim() !== '') {
        candidates.push({ source: 'documento', raw: input.documento });
    }
    if (
        input.identification != null &&
        String(input.identification).trim() !== ''
    ) {
        candidates.push({
            source: 'identification',
            raw: input.identification,
        });
    }
    if (input.document != null && String(input.document).trim() !== '') {
        candidates.push({ source: 'document', raw: input.document });
    }
    if (input.passport != null && String(input.passport).trim() !== '') {
        candidates.push({ source: 'passport', raw: input.passport });
    }

    for (const doc of input.documents || []) {
        const numero = doc?.numero;
        if (numero == null || String(numero).trim() === '') continue;
        const tipo = String(doc.tipo || 'DOC').toUpperCase();
        candidates.push({ source: `document:${tipo}`, raw: numero });
    }

    for (const c of candidates) {
        const assessment = assessCpf(c.raw);
        if (assessment.status === 'valid') {
            return {
                cpf: assessment.formatted,
                source: c.source,
                assessment,
            };
        }
    }

    // Sem CPF válido: inválido só se campo explícito cpf/ssn veio preenchido e inválido.
    for (const key of ['cpf', 'ssn'] as const) {
        const raw = input[key];
        if (raw == null || String(raw).trim() === '') continue;
        const assessment = assessCpf(raw);
        if (assessment.status === 'invalid') {
            return {
                cpf: String(raw),
                source: key,
                assessment,
            };
        }
    }

    return {
        cpf: null,
        source: null,
        assessment: { status: 'missing' },
    };
}

/** Atalho: retorna string de CPF (válida ou raw inválida) / null se missing. */
export function extractGuestCpfString(
    input: GuestCpfSourceInput
): string | null {
    return pickGuestCpf(input).cpf;
}
