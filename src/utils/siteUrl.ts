/**
 * URL pública do frontend (site/app) — única fonte para links enviados ao cliente.
 *
 * Variáveis (prioridade):
 * - Desenvolvimento: SITE_URL_DEV → FRONTEND_URL_DEV → EXPO_PUBLIC_SITE_URL → SITE_URL → FRONTEND_URL
 * - Produção:        SITE_URL → FRONTEND_URL → EXPO_PUBLIC_SITE_URL
 */

function primeiroNaoVazio(...valores: Array<string | undefined | null>): string | null {
    for (const valor of valores) {
        const v = String(valor ?? '').trim();
        if (v) return v;
    }
    return null;
}

function normalizarBaseUrl(url: string): string {
    return url.replace(/\/+$/, '');
}

/** true quando não estamos em produção (NODE_ENV/APP_ENV). */
export function isAmbienteDesenvolvimento(): boolean {
    const env = String(
        process.env.NODE_ENV || process.env.APP_ENV || ''
    ).toLowerCase();
    if (env === 'production' || env === 'prod') return false;
    if (env === 'development' || env === 'dev' || env === 'local' || env === 'test') {
        return true;
    }
    // nodemon/local costuma não definir NODE_ENV — trata como desenvolvimento
    return env === '';
}

/**
 * Base do site conforme o ambiente.
 * Não embute porta/host no restante do código — configure via .env.
 */
export function obterUrlBaseSite(): string {
    if (isAmbienteDesenvolvimento()) {
        const baseDev = primeiroNaoVazio(
            process.env.SITE_URL_DEV,
            process.env.FRONTEND_URL_DEV,
            process.env.EXPO_PUBLIC_SITE_URL,
            process.env.SITE_URL,
            process.env.FRONTEND_URL,
            process.env.BASE_URL
        );
        return normalizarBaseUrl(baseDev || 'http://localhost:8081');
    }

    const baseProd = primeiroNaoVazio(
        process.env.SITE_URL,
        process.env.FRONTEND_URL,
        process.env.EXPO_PUBLIC_SITE_URL,
        process.env.BASE_URL
    );
    return normalizarBaseUrl(baseProd || 'https://jangoingressos.com.br');
}

/** Link público da reserva: {base}/reserva/{token} */
export function montarUrlPublicaReserva(token: string): string {
    const tokenLimpo = String(token || '').trim();
    const base = obterUrlBaseSite();
    return `${base}/reserva/${tokenLimpo}`;
}
