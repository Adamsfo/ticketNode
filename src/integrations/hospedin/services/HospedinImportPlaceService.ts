import { HospedinPlace } from '../../../models/HospedinPlace';
import type { HospedinImportResult } from '../dto';
import { HospedinLogger } from '../logger/HospedinLogger';
import { HospedinPlaceMapper } from '../mapper/HospedinPlaceMapper';
import { hospedinAuthService } from './HospedinAuthService';
import { hospedinPlaceService } from './HospedinPlaceService';
import { hospedinSyncLogService } from './HospedinSyncLogService';

/**
 * Importa places → hospedin_places (staging only).
 * Não cria/altera EventoSuite nem chama services do Jango.
 */
export async function importHospedinPlaces(): Promise<HospedinImportResult> {
    const started = Date.now();
    const operacao = 'import_places';
    let accountId: string | null = null;

    try {
        await hospedinAuthService.ensureAuthenticated();
        accountId = await hospedinAuthService.ensureAccountId();
        HospedinLogger.info('import places iniciado', { accountId });

        const dtos = await hospedinPlaceService.listAllPlaces(accountId);
        const now = new Date();
        let upserted = 0;

        for (const dto of dtos) {
            const internal = HospedinPlaceMapper.toInternal(dto, now);
            await HospedinPlace.upsert(internal);
            upserted += 1;
        }

        const durationMs = Date.now() - started;
        const result: HospedinImportResult = {
            operacao,
            fetched: dtos.length,
            upserted,
            accountId,
            durationMs,
            sucesso: true,
        };

        await hospedinSyncLogService.write({
            operacao,
            endpoint: `/api/v2/${accountId}/places`,
            metodo: 'GET',
            request: { accountId },
            response: { fetched: dtos.length, upserted },
            status: 200,
            duracaoMs: durationMs,
            sucesso: true,
        });

        HospedinLogger.info('import places concluído', result);
        return result;
    } catch (err: any) {
        const durationMs = Date.now() - started;
        const erro = err?.message || 'erro desconhecido';
        await hospedinSyncLogService.write({
            operacao,
            endpoint: accountId ? `/api/v2/${accountId}/places` : null,
            metodo: 'GET',
            request: { accountId },
            response: null,
            status: err?.status ?? 500,
            duracaoMs: durationMs,
            sucesso: false,
            erro,
        });
        throw err;
    }
}
