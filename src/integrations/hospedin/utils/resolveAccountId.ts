import { HospedinApiClient } from '../api/HospedinApiClient';
import { getHospedinConfig } from '../constants/config';
import { HospedinLogger } from '../logger/HospedinLogger';
import { HospedinApiError } from '../types/errors';
import {
    extractAccountCandidatesFromJwt,
    uniqueCandidates,
} from './jwtAccountCandidates';

export type HospedinAccountSource =
    | 'override'
    | 'memory'
    | 'jwt'
    | 'discovery_endpoint'
    | 'env';

/**
 * Resolve account_id sem depender de /my_account (403 nesta conta).
 *
 * Ordem:
 * 1) override
 * 2) memória
 * 3) JWT
 * 4) HOSPEDIN_ACCOUNT_ID (env) — preferencial para esta integração
 * 5) probes best-effort (não documentados)
 */
export async function resolveHospedinAccountId(
    client: HospedinApiClient,
    options?: { override?: string | null }
): Promise<{ accountId: string; source: HospedinAccountSource }> {
    const override = (options?.override || '').trim();
    if (override) {
        client.setAccountId(override);
        HospedinLogger.auth('account_id via override', { accountId: override });
        return { accountId: override, source: 'override' };
    }

    const cached = client.getAccountId();
    if (cached) {
        return { accountId: cached, source: 'memory' };
    }

    const cfg = getHospedinConfig();
    const token = client.getToken();
    const jwtCandidates = token
        ? extractAccountCandidatesFromJwt(token)
        : [];

    // Env tem prioridade prática (slug ou ID numérico conhecidos).
    if (cfg.accountId) {
        client.setAccountId(cfg.accountId);
        HospedinLogger.auth('account_id via env', {
            accountId: cfg.accountId,
        });
        return { accountId: cfg.accountId, source: 'env' };
    }

    if (jwtCandidates.length) {
        const accountId = jwtCandidates[0];
        client.setAccountId(accountId);
        HospedinLogger.auth('account_id via jwt', { accountId });
        return { accountId, source: 'jwt' };
    }

    // Probes silenciosos (best-effort)
    const discoveryPaths = [
        '/api/v2/accounts',
        '/api/v2/my_accounts',
        '/api/v2/users/me',
    ];
    for (const path of discoveryPaths) {
        try {
            const data = await client.get<any>(path, { auth: true, log: false });
            const found = uniqueCandidates(
                data?.id,
                data?.account_id,
                data?.slug,
                data?.data
            );
            if (found.length) {
                client.setAccountId(found[0]);
                HospedinLogger.auth('account_id via discovery', {
                    accountId: found[0],
                    path,
                });
                return { accountId: found[0], source: 'discovery_endpoint' };
            }
        } catch {
            // ignora
        }
    }

    throw new HospedinApiError(
        'Hospedin: configure HOSPEDIN_ACCOUNT_ID (ex.: 69532 ou pousada-jango).',
        400
    );
}
