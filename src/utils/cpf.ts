/**
 * CPF brasileiro — normalização, formatação e validação.
 * Usado pelo GuestResolverService (chave única de pessoa = Usuario.cpf).
 */

export function onlyDigits(value: unknown): string {
    return String(value ?? '').replace(/\D/g, '');
}

/** Formato exigido pelo model Usuario: 000.000.000-00 */
export function formatCpf(digitsOrMasked: unknown): string | null {
    const d = onlyDigits(digitsOrMasked);
    if (d.length !== 11) return null;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function isValidCpf(digitsOrMasked: unknown): boolean {
    const cpf = onlyDigits(digitsOrMasked);
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    const calc = (base: string, factor: number) => {
        let sum = 0;
        for (let i = 0; i < base.length; i += 1) {
            sum += Number(base[i]) * (factor - i);
        }
        const mod = (sum * 10) % 11;
        return mod === 10 ? 0 : mod;
    };

    const d1 = calc(cpf.slice(0, 9), 10);
    const d2 = calc(cpf.slice(0, 10), 11);
    return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

export type CpfAssessment =
    | { status: 'valid'; digits: string; formatted: string }
    | { status: 'missing' }
    | { status: 'invalid'; raw: string };

export function assessCpf(raw: unknown): CpfAssessment {
    if (raw == null || String(raw).trim() === '') {
        return { status: 'missing' };
    }
    const digits = onlyDigits(raw);
    if (!digits) return { status: 'missing' };
    if (!isValidCpf(digits)) {
        return { status: 'invalid', raw: String(raw) };
    }
    const formatted = formatCpf(digits);
    if (!formatted) return { status: 'invalid', raw: String(raw) };
    return { status: 'valid', digits, formatted };
}
