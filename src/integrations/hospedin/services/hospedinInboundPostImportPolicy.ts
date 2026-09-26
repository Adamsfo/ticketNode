import { IntegrationSyncTrigger } from '../../../models/IntegrationSyncExecution';
import { parseHospedinSyncMode } from '../utils/operationalSyncWindow';

/**
 * Após download + filtro local (check-in futuro), decide se o scheduler
 * incremental pode omitir integration_sync_execution.
 * Não impede chamada à API — só evita validate/sync + histórico vazio.
 */
export function shouldOmitInboundExecutionAfterPreflight(input: {
    trigger: string;
    mode?: string;
    /** Nova ou alterada na staging após comparar com hash/conteúdo. */
    importWorkFound: boolean;
    hasPendingFutureSync: boolean;
}): boolean {
    const trigger = String(input.trigger || '').toUpperCase();
    if (
        trigger === IntegrationSyncTrigger.MANUAL ||
        trigger === IntegrationSyncTrigger.API ||
        trigger === IntegrationSyncTrigger.WEBHOOK
    ) {
        return false;
    }
    const mode = parseHospedinSyncMode(input.mode, 'incremental');
    if (mode === 'full') {
        return false;
    }
    if (input.importWorkFound) {
        return false;
    }
    return !input.hasPendingFutureSync;
}

/** Trabalho real pós-download (scheduler incremental). */
export function resolveInboundWorkFoundAfterPreflight(input: {
    importWorkFound: boolean;
    hasPendingFutureSync: boolean;
}): boolean {
    return input.importWorkFound || input.hasPendingFutureSync;
}
