import { logger } from '../../../utils/logger';
import { HospedinPlace } from '../../../models/HospedinPlace';
import { HospedinOutboundSyncState } from '../../../models/HospedinOutboundSyncState';
import { PlaceSuiteMappingStatus } from '../../../models/HospedinPlaceSuiteMap';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaHospede } from '../../../models/ReservaHospede';
import { ReservaSuite } from '../../../models/ReservaSuite';
import { Usuario } from '../../../models/Usuario';
import { hospedinPlaceSuiteMapService } from '../services/HospedinPlaceSuiteMapService';
import {
    hospedinReservationService,
    HospedinReservationService,
} from '../services/HospedinReservationService';
import {
    buildOutboundReservationPayload,
} from './HospedinOutboundPayloadBuilder';
import { resolveSuiteExistingHospedinReservationId } from './hospedinOutboundCreateSuiteLink';
import {
    hospedinOutboundGuestService,
    HospedinOutboundGuestService,
} from './HospedinOutboundGuestService';

const log = logger.child('HospedinOutboundSuiteReservation');

export type OutboundSuiteLine = ReservaSuite & {
    ReservaHospede?: ReservaHospede[];
    hospedinReservationId?: string | null;
};

export type LoadedReservaForSuite = ReservaHospedagem & {
    observacaoImportada?: string | null;
    observacoes?: string | null;
    idExterno?: string | null;
    ReservaSuite?: OutboundSuiteLine[];
};

export type SuiteReservationResult = {
    reservationId: string;
    codigoExterno: string | null;
    guestId: string;
    wasCreated: boolean;
};

export type EnsureSuiteReservationInput = {
    linha: OutboundSuiteLine;
    suiteIndex: number;
    suites: OutboundSuiteLine[];
    hospedagem: LoadedReservaForSuite;
    idReserva: number;
    stateId: number;
    reservaTitularGuestId: number;
    reservaIdExterno: string | null;
    queueReservationId: string | null;
    correlationId?: string;
    logContext?: 'create' | 'update';
};

export function sortOutboundSuites(suites: OutboundSuiteLine[]): OutboundSuiteLine[] {
    return [...suites].sort((a, b) => Number(a.id) - Number(b.id));
}

function titularGuestName(
    hospedes: Array<{ nome?: string | null }>
): string | null {
    const named = hospedes
        .map((h) => String(h.nome || '').trim())
        .filter(Boolean);
    return named[0] ?? null;
}

function formatUsuarioGuestName(
    usuario: { nomeCompleto?: string | null; sobreNome?: string | null } | null
): string | null {
    if (!usuario) {
        return null;
    }
    const nome = [usuario.nomeCompleto, usuario.sobreNome]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join(' ')
        .trim();
    return nome || null;
}

function firstNamedGuestFromSuites(suites: OutboundSuiteLine[]): string | null {
    for (const linha of suites) {
        const nome = titularGuestName(linha.ReservaHospede ?? []);
        if (nome) {
            return nome;
        }
    }
    return null;
}

export async function resolveReservaTitularGuestName(
    hospedagem: LoadedReservaForSuite,
    suites: OutboundSuiteLine[]
): Promise<string | null> {
    const idUsuario = Number(hospedagem.idUsuario);
    if (Number.isFinite(idUsuario) && idUsuario > 0) {
        const usuario = await Usuario.findByPk(idUsuario, {
            attributes: ['id', 'nomeCompleto', 'sobreNome'],
        });
        const nomeUsuario = formatUsuarioGuestName(usuario);
        if (nomeUsuario) {
            return nomeUsuario;
        }
    }

    return firstNamedGuestFromSuites(suites);
}

export async function resolveReservaTitularGuestId(input: {
    outboundStateId: number;
    stateRow: HospedinOutboundSyncState;
    hospedagem: LoadedReservaForSuite;
    suites: OutboundSuiteLine[];
    guestService?: HospedinOutboundGuestService;
}): Promise<number> {
    const guestService = input.guestService ?? hospedinOutboundGuestService;
    const cached = Number(String(input.stateRow.hospedin_guest_id || '').trim());
    if (Number.isFinite(cached) && cached > 0) {
        return cached;
    }

    const guestName = await resolveReservaTitularGuestName(
        input.hospedagem,
        input.suites
    );
    if (!guestName) {
        throw new Error('Reserva sem hóspede titular com nome.');
    }

    return guestService.resolveOrCreateGuestId({
        outboundStateId: input.outboundStateId,
        existingGuestId: input.stateRow.hospedin_guest_id,
        guestName,
    });
}

export async function persistSuiteHospedinReservationId(
    linha: OutboundSuiteLine,
    reservationId: string
): Promise<void> {
    const current = String(linha.hospedinReservationId || '').trim();
    if (current === reservationId) {
        return;
    }
    await ReservaSuite.update(
        { hospedinReservationId: reservationId },
        { where: { id: linha.id } }
    );
    linha.hospedinReservationId = reservationId;
}

export async function resolveSuitePlaceIdsForLine(
    linha: OutboundSuiteLine
): Promise<
    | { ok: true; placeId: number; placeTypeId: number }
    | { ok: false; errorCode: string; message: string }
> {
    const idEventoSuite = Number(linha.idEventoSuite);
    if (!Number.isFinite(idEventoSuite) || idEventoSuite <= 0) {
        return {
            ok: false,
            errorCode: 'SUITE_UNMAPPED',
            message: 'Suíte da reserva inválida para mapeamento Hospedin.',
        };
    }

    const map =
        await hospedinPlaceSuiteMapService.findByEventoSuiteId(idEventoSuite);
    if (
        !map ||
        !map.ativo ||
        String(map.mapping_status || '').toUpperCase() !==
            PlaceSuiteMappingStatus.LINKED
    ) {
        return {
            ok: false,
            errorCode: 'SUITE_UNMAPPED',
            message: `Suíte id=${idEventoSuite} sem mapeamento Hospedin ativo (LINKED).`,
        };
    }

    const placeId = Number(map.place_id);
    const placeRow = await HospedinPlace.findOne({
        where: { place_id: placeId },
    });
    const placeTypeId = placeRow?.place_type_id
        ? Number(placeRow.place_type_id)
        : null;

    if (!Number.isFinite(placeId) || placeId <= 0) {
        return {
            ok: false,
            errorCode: 'PLACE_INVALID',
            message: 'place_id inválido no mapeamento Hospedin.',
        };
    }

    if (!placeTypeId || !Number.isFinite(placeTypeId) || placeTypeId <= 0) {
        return {
            ok: false,
            errorCode: 'PLACE_TYPE_MISSING',
            message: `place_type_id ausente para place_id=${placeId}. Reimporte places.`,
        };
    }

    return { ok: true, placeId, placeTypeId };
}

/** IDs Hospedin distintos para CANCEL multi-suíte (com fallback legado 1:1). */
export function collectDistinctHospedinReservationIds(input: {
    suites: OutboundSuiteLine[];
    reservaIdExterno: string | null;
    queueReservationId: string | null;
}): string[] {
    const sorted = sortOutboundSuites(input.suites);
    const ids = new Set<string>();

    for (let suiteIndex = 0; suiteIndex < sorted.length; suiteIndex++) {
        const reservationId = resolveSuiteHospedinReservationId({
            linha: sorted[suiteIndex],
            suiteIndex,
            suites: sorted,
            reservaIdExterno: input.reservaIdExterno,
            queueReservationId: input.queueReservationId,
        });
        if (reservationId) {
            ids.add(reservationId);
        }
    }

    if (ids.size === 0) {
        const legacy =
            String(input.reservaIdExterno || '').trim() ||
            String(input.queueReservationId || '').trim();
        if (legacy) {
            ids.add(legacy);
        }
    }

    return [...ids];
}

export function resolveSuiteHospedinReservationId(input: {
    linha: OutboundSuiteLine;
    suiteIndex: number;
    suites: OutboundSuiteLine[];
    reservaIdExterno: string | null;
    queueReservationId: string | null;
}): string | null {
    const fromResolver = resolveSuiteExistingHospedinReservationId({
        linha: input.linha,
        suiteIndex: input.suiteIndex,
        suites: input.suites,
        reservaIdExterno: input.reservaIdExterno,
        queueReservationId: input.queueReservationId,
    });
    if (fromResolver) {
        return fromResolver;
    }
    const fromLine = String(input.linha.hospedinReservationId || '').trim();
    return fromLine || null;
}

export class HospedinOutboundSuiteReservationService {
    constructor(
        private readonly reservationService: HospedinReservationService = hospedinReservationService
    ) {}

    async ensureSuiteReservation(
        input: EnsureSuiteReservationInput
    ): Promise<
        | { ok: true; result: SuiteReservationResult }
        | { ok: false; errorCode: string; message: string }
    > {
        const {
            linha,
            suiteIndex,
            suites,
            hospedagem,
            idReserva,
            reservaTitularGuestId,
            reservaIdExterno,
            queueReservationId,
            correlationId,
            logContext = 'create',
        } = input;

        const existingId = resolveSuiteHospedinReservationId({
            linha,
            suiteIndex,
            suites,
            reservaIdExterno,
            queueReservationId,
        });

        if (existingId) {
            await persistSuiteHospedinReservationId(linha, existingId);
            return {
                ok: true,
                result: {
                    reservationId: existingId,
                    codigoExterno: null,
                    guestId: String(reservaTitularGuestId),
                    wasCreated: false,
                },
            };
        }

        const placeContext = await resolveSuitePlaceIdsForLine(linha);
        if (!placeContext.ok) {
            return {
                ok: false,
                errorCode: placeContext.errorCode,
                message: placeContext.message,
            };
        }

        const payload = buildOutboundReservationPayload({
            idReservaHospedagem: idReserva,
            checkin: new Date(hospedagem.checkin),
            checkout: new Date(hospedagem.checkout),
            observacaoImportada: (hospedagem as any).observacaoImportada,
            observacoes: hospedagem.observacoes,
            adultos: Number(linha.adultos || 0),
            criancas: Number(linha.criancas || 0),
            placeId: placeContext.placeId,
            placeTypeId: placeContext.placeTypeId,
            guestId: reservaTitularGuestId,
        });

        log.info(`outbound:${logContext}:post-reservation`, {
            correlationId,
            idReservaHospedagem: idReserva,
            idReservaSuite: linha.id,
            placeId: placeContext.placeId,
            placeTypeId: placeContext.placeTypeId,
            guestId: reservaTitularGuestId,
        });

        const created = await this.reservationService.createReservation(payload);
        const reservationId = String(created.reservationId);
        await persistSuiteHospedinReservationId(linha, reservationId);

        return {
            ok: true,
            result: {
                reservationId,
                codigoExterno: created.searchableCode ?? null,
                guestId: String(reservaTitularGuestId),
                wasCreated: true,
            },
        };
    }
}

export const hospedinOutboundSuiteReservationService =
    new HospedinOutboundSuiteReservationService();
