import { HospedinSyncLog } from '../../../models/HospedinSyncLog';
import { HospedinLogger } from '../logger/HospedinLogger';
import { maskSensitiveDeep } from '../utils/maskSensitive';

export type HospedinSyncLogInput = {
    operacao: string;
    endpoint?: string | null;
    metodo?: string | null;
    request?: unknown;
    response?: unknown;
    status?: number | null;
    duracaoMs?: number | null;
    sucesso: boolean;
    erro?: string | null;
};

/**
 * Persistência padronizada em hospedin_sync_log.
 */
export class HospedinSyncLogService {
    async write(input: HospedinSyncLogInput): Promise<void> {
        try {
            await HospedinSyncLog.create({
                operacao: input.operacao,
                endpoint: input.endpoint ?? null,
                metodo: input.metodo ?? null,
                request_json:
                    (maskSensitiveDeep(input.request) as object) ?? null,
                response_json:
                    (maskSensitiveDeep(input.response) as object) ?? null,
                status: input.status ?? null,
                duracao_ms: input.duracaoMs ?? null,
                sucesso: input.sucesso,
                erro: input.erro ?? null,
                data: new Date(),
            });
        } catch (err: any) {
            HospedinLogger.error('falha ao gravar hospedin_sync_log', {
                message: err?.message,
                operacao: input.operacao,
            });
        }
    }
}

export const hospedinSyncLogService = new HospedinSyncLogService();
