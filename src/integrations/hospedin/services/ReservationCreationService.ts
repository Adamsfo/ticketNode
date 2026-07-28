import { getHospedinConfig } from '../constants/config';
import {
    HospedinDomainMappingError,
    HospedinReservationDomainMapper,
} from '../mapper/HospedinReservationDomainMapper';
import type { ReservationExecutionContext } from '../sync/types';
import { HospedinLogger } from '../logger/HospedinLogger';
import { guestResolverService } from '../../../services/GuestResolverService';
import { TipoReservaHospede } from '../../../models/ReservaHospede';
import type { HospedeCheckoutItem } from '../../../services/reservaSuiteService';

export type ReservationCreationResult = {
    idReservaHospedagem: number;
    idEvento: number;
    idEventoSuite: number;
};

/**
 * Adapta o contexto Hospedin e reutiliza o fluxo de domínio do Jango.
 * Resolução de hóspedes/CPF → GuestResolverService (não misturar aqui).
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

        guestResolverService.clearCache();
        const suite = params.suites[0];
        const resolvedHospedes: HospedeCheckoutItem[] = [];
        for (const g of suite.hospedes) {
            const resolved = await guestResolverService.resolveGuest(
                {
                    nome: g.nome,
                    tipo: g.tipo,
                    dataNascimento: g.dataNascimento,
                    cpf: g.cpf,
                    email: g.email,
                    telefone: g.telefone,
                },
                {
                    reservationId: ctx.decision.reservationId,
                    correlationId: ctx.correlationId,
                }
            );
            resolvedHospedes.push({
                ...g,
                idUsuario: resolved.idUsuario,
            });
        }

        const titular =
            resolvedHospedes.find(
                (h) =>
                    h.tipo === TipoReservaHospede.Adulto && h.idUsuario != null
            ) || resolvedHospedes.find((h) => h.idUsuario != null);

        const idUsuarioReserva = titular?.idUsuario
            ? Number(titular.idUsuario)
            : syncUserId;

        const suites = [
            {
                ...suite,
                hospedes: resolvedHospedes,
            },
        ];

        HospedinLogger.info('creation:checkout_params', {
            correlation_id: ctx.correlationId,
            reservation_id: ctx.decision.reservationId,
            idEvento: params.idEvento,
            idEventoSuite: ctx.resolvedSuite.idEventoSuite,
            idUsuario: idUsuarioReserva,
            adultos: suites[0]?.adultos,
            criancas: suites[0]?.criancas,
            hospedes: suites[0]?.hospedes.length,
        });

        const { checkoutHospedagem } = await import(
            '../../../services/reservaSuiteService'
        );

        const resultado = await checkoutHospedagem({
            idEvento: params.idEvento,
            idUsuario: idUsuarioReserva,
            checkin: params.checkin,
            checkout: params.checkout,
            suites,
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
