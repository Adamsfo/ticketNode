import { HospedinPlaceType } from '../../../models/HospedinPlaceType';
import type { HospedinImportResult } from '../dto';
import { HospedinLogger } from '../logger/HospedinLogger';
import { HospedinPlaceTypeMapper } from '../mapper/HospedinPlaceTypeMapper';
import { hospedinAuthService } from './HospedinAuthService';
import { hospedinPlaceService } from './HospedinPlaceService';
import { hospedinSyncLogService } from './HospedinSyncLogService';

/**
 * Importa place_types → hospedin_place_types (staging only).
 * Não cria/altera EventoSuite nem chama services do Jango.
 */
export async function importHospedinPlaceTypes(): Promise<HospedinImportResult> {
    const started = Date.now();
    const operacao = 'import_place_types';
    let accountId: string | null = null;

    try {
        await hospedinAuthService.ensureAuthenticated();
        accountId = await hospedinAuthService.ensureAccountId();
        HospedinLogger.info('import place_types iniciado', { accountId });

        const dtos = await hospedinPlaceService.listAllPlaceTypes(accountId);
        const now = new Date();
        let upserted = 0;

        for (const dto of dtos) {
            const internal = HospedinPlaceTypeMapper.toInternal(dto, now);
            await HospedinPlaceType.upsert(internal);
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
            endpoint: `/api/v2/${accountId}/place_types`,
            metodo: 'GET',
            request: { accountId },
            response: { fetched: dtos.length, upserted },
            status: 200,
            duracaoMs: durationMs,
            sucesso: true,
        });

        HospedinLogger.info('import place_types concluído', result);
        return result;
    } catch (err: any) {
        const durationMs = Date.now() - started;
        const erro = err?.message || 'erro desconhecido';
        await hospedinSyncLogService.write({
            operacao,
            endpoint: accountId
                ? `/api/v2/${accountId}/place_types`
                : null,
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
