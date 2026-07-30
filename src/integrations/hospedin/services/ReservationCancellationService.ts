import { getHospedinConfig } from '../constants/config';
import {
    HospedinDomainMappingError,
} from '../mapper/HospedinReservationDomainMapper';
import { HospedinLogger } from '../logger/HospedinLogger';
import type { ReservationExecutionContext } from '../sync/types';

export type ReservationCancellationResult = {
    idReservaHospedagem: number;
    alreadyCancelled: boolean;
};

/**
 * Encapsula cancelamento Hospedin → Jango.
 * Reutiliza cancelarReservaHospedagem (status; sem delete; preserva hóspedes/pagamentos).
 */
export class ReservationCancellationService {
    async cancelFromHospedin(
        ctx: ReservationExecutionContext
    ): Promise<ReservationCancellationResult> {
        const syncUserId = getHospedinConfig().syncUserId;
        if (!syncUserId) {
            throw new HospedinDomainMappingError(
                'Configure HOSPEDIN_SYNC_USER_ID (Usuario cliente técnico da integração).',
                'CONFIG_MISSING'
            );
        }

        const idReservaHospedagem = Number(ctx.syncState.internal_entity_id);
        if (!Number.isFinite(idReservaHospedagem) || idReservaHospedagem <= 0) {
            throw new HospedinDomainMappingError(
                'internal_entity_id ausente — não há reserva Jango para cancelar.',
                'INTERNAL_ENTITY_MISSING'
            );
        }

        const { ReservaHospedagem, StatusReservaHospedagem } = await import(
            '../../../models/ReservaHospedagem'
        );
        const atual = await ReservaHospedagem.findByPk(idReservaHospedagem);
        if (!atual) {
            throw new HospedinDomainMappingError(
                `ReservaHospedagem id=${idReservaHospedagem} não encontrada.`,
                'INTERNAL_ENTITY_MISSING'
            );
        }

        if (atual.status === StatusReservaHospedagem.Cancelada) {
            HospedinLogger.info('cancellation:already_cancelled', {
                correlation_id: ctx.correlationId,
                reservation_id: ctx.decision.reservationId,
                idReservaHospedagem,
            });
            return { idReservaHospedagem, alreadyCancelled: true };
        }

        const { cancelarReservaHospedagem } = await import(
            '../../../services/reservaSuiteService'
        );

        await cancelarReservaHospedagem(
            idReservaHospedagem,
            syncUserId,
            `Cancelamento sincronizado Hospedin (reservation_id=${ctx.decision.reservationId}).`
        );

        const { reservationOriginEnrichmentService } = await import(
            './ReservationOriginEnrichmentService'
        );
        await reservationOriginEnrichmentService.enrichFromHospedinStaging({
            idReservaHospedagem,
            staging: ctx.stagingReservation,
            correlationId: ctx.correlationId,
        });

        HospedinLogger.info('cancellation:done', {
            correlation_id: ctx.correlationId,
            reservation_id: ctx.decision.reservationId,
            idReservaHospedagem,
        });

        return { idReservaHospedagem, alreadyCancelled: false };
    }
}

export const reservationCancellationService =
    new ReservationCancellationService();
