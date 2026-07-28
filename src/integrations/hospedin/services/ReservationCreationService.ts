import { getHospedinConfig } from '../constants/config';
import {
    HospedinDomainMappingError,
    HospedinReservationDomainMapper,
} from '../mapper/HospedinReservationDomainMapper';
import type { ReservationExecutionContext } from '../sync/types';
import { HospedinLogger } from '../logger/HospedinLogger';

export type ReservationCreationResult = {
    idReservaHospedagem: number;
    idEvento: number;
    idEventoSuite: number;
};

/**
 * Adapta o contexto Hospedin e reutiliza o fluxo de domínio do Jango.
 * O Executor conhece apenas este contrato — não chama checkoutHospedagem.
 */
export class ReservationCreationService {
    async createFromHospedin(
        ctx: ReservationExecutionContext
    ): Promise<ReservationCreationResult> {
        const syncUserId = getHospedinConfig().syncUserId;
        if (!syncUserId) {
            throw new HospedinDomainMappingError(
                'Configure HOSPEDIN_SYNC_USER_ID (Usuario cliente técnico da integração).',
                'CONFIG_MISSING'
            );
        }

        const params = HospedinReservationDomainMapper.toCreateParams({
            staging: ctx.stagingReservation,
            resolvedSuite: ctx.resolvedSuite,
        });

        HospedinLogger.info('creation:checkout_params', {
            correlation_id: ctx.correlationId,
            reservation_id: ctx.decision.reservationId,
            idEvento: params.idEvento,
            idEventoSuite: ctx.resolvedSuite.idEventoSuite,
            adultos: params.suites[0]?.adultos,
            criancas: params.suites[0]?.criancas,
            hospedes: params.suites[0]?.hospedes.length,
        });

        const { checkoutHospedagem } = await import(
            '../../../services/reservaSuiteService'
        );

        const resultado = await checkoutHospedagem({
            idEvento: params.idEvento,
            idUsuario: syncUserId,
            checkin: params.checkin,
            checkout: params.checkout,
            suites: params.suites,
            origem: 'integracao',
            observacoes: params.observacoes,
            idUsuarioOperador: syncUserId,
            pagamento: null,
        });

        return {
            idReservaHospedagem: Number(resultado.hospedagem.id),
            idEvento: params.idEvento,
            idEventoSuite: ctx.resolvedSuite.idEventoSuite,
        };
    }
}

export const reservationCreationService = new ReservationCreationService();
