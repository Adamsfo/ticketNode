import { IntegrationSyncExecution } from '../../../models/IntegrationSyncExecution';
import { IntegrationSyncExecutionStatus } from '../../../models/IntegrationSyncExecution';
import { ProdutorAcesso, TipoAcesso } from '../../../models/Produtor';
import { Usuario } from '../../../models/Usuario';
import { CustomError } from '../../../utils/customError';
import { mapExecutionRow } from '../../core/ExecutionHistoryService';

export const HOSPEDIN_OUTBOUND_EXECUTION_PROVIDER = 'HOSPEDIN_OUTBOUND';

export type HospedinOutboundExecutionAdminDismissal = {
    dismissed: true;
    dismissedAt: string;
    dismissedByUserId: number;
    dismissedByUserName: string;
};

function formatUsuarioNome(
    usuario: Pick<Usuario, 'nomeCompleto' | 'sobreNome' | 'email'> | null,
    idUsuario: number
): string {
    if (!usuario) {
        return String(idUsuario);
    }
    const nome = [usuario.nomeCompleto, usuario.sobreNome]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join(' ')
        .trim();
    return nome || String(usuario.email || idUsuario);
}

export function readHospedinOutboundAdminDismissal(
    summaryJson: unknown
): HospedinOutboundExecutionAdminDismissal | null {
    if (!summaryJson || typeof summaryJson !== 'object' || Array.isArray(summaryJson)) {
        return null;
    }
    const dismissal = (summaryJson as { adminDismissal?: HospedinOutboundExecutionAdminDismissal })
        .adminDismissal;
    if (!dismissal?.dismissed) {
        return null;
    }
    return dismissal;
}

export async function assertIntegracoesHospedagemAdmin(
    idUsuario: number
): Promise<void> {
    const usuario = await Usuario.findByPk(idUsuario, {
        attributes: ['id', 'admGeral'],
    });

    if (!usuario) {
        throw new CustomError('Usuário não autenticado.', 401, '');
    }

    if (usuario.admGeral) {
        return;
    }

    const adminAcesso = await ProdutorAcesso.findOne({
        where: {
            idUsuario,
            tipoAcesso: TipoAcesso.Administrador,
        },
        attributes: ['id'],
    });

    if (!adminAcesso) {
        throw new CustomError(
            'Sem permissão para administrar integrações.',
            403,
            ''
        );
    }
}

export async function dismissHospedinOutboundExecutionError(
    executionId: number,
    idUsuario: number
) {
    await assertIntegracoesHospedagemAdmin(idUsuario);

    const execution = await IntegrationSyncExecution.findByPk(executionId);
    if (!execution) {
        throw new CustomError('Execução não encontrada.', 404, '');
    }

    if (execution.provider !== HOSPEDIN_OUTBOUND_EXECUTION_PROVIDER) {
        throw new CustomError(
            'Somente execuções HOSPEDIN_OUTBOUND podem ser ignoradas por este endpoint.',
            400,
            ''
        );
    }

    const status = String(execution.status || '').toUpperCase();
    if (
        status !== IntegrationSyncExecutionStatus.FAILED &&
        status !== IntegrationSyncExecutionStatus.PARTIAL
    ) {
        throw new CustomError(
            'Somente execuções com falha podem ser ignoradas.',
            400,
            ''
        );
    }

    const currentSummary =
        execution.summaryJson &&
        typeof execution.summaryJson === 'object' &&
        !Array.isArray(execution.summaryJson)
            ? { ...(execution.summaryJson as Record<string, unknown>) }
            : {};

    const existingDismissal = readHospedinOutboundAdminDismissal(currentSummary);
    if (existingDismissal?.dismissed) {
        return mapExecutionRow(execution);
    }

    const usuario = await Usuario.findByPk(idUsuario, {
        attributes: ['id', 'nomeCompleto', 'sobreNome', 'email'],
    });

    const adminDismissal: HospedinOutboundExecutionAdminDismissal = {
        dismissed: true,
        dismissedAt: new Date().toISOString(),
        dismissedByUserId: idUsuario,
        dismissedByUserName: formatUsuarioNome(usuario, idUsuario),
    };

    await execution.update({
        summaryJson: {
            ...currentSummary,
            adminDismissal,
        },
    });

    await execution.reload();
    return mapExecutionRow(execution);
}
