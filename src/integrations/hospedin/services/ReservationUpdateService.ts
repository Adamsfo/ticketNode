import { Transaction } from 'sequelize';
import connection from '../../../database';
import { HospedinLogger } from '../logger/HospedinLogger';
import {
    HospedinDomainMappingError,
} from '../mapper/HospedinReservationDomainMapper';
import type { ReservationExecutionContext } from '../sync/types';
import type { ReservationDiffChange } from './ReservationDiffService';
import {
    reservationDiffService,
    type ReservationDiffSnapshot,
} from './ReservationDiffService';
import {
    reservationPatchBuilder,
    type ReservationPatch,
} from './ReservationPatchBuilder';

export type ReservationUpdateResult = {
    idReservaHospedagem: number;
    applied: boolean;
    changes: ReservationDiffChange[];
};

/**
 * Aplica ReservationPatch no domínio Jango.
 * Não decide. Não lê DTO Hospedin. Sem sync financeiro.
 */
export class ReservationUpdateService {
    async updateFromHospedin(
        ctx: ReservationExecutionContext,
        desired: ReservationDiffSnapshot
    ): Promise<ReservationUpdateResult> {
        const idReservaHospedagem = Number(ctx.syncState.internal_entity_id);
        if (!Number.isFinite(idReservaHospedagem) || idReservaHospedagem <= 0) {
            throw new HospedinDomainMappingError(
                'internal_entity_id ausente — não há reserva Jango para atualizar.',
                'INTERNAL_ENTITY_MISSING'
            );
        }

        const { ReservaHospedagem } = await import(
            '../../../models/ReservaHospedagem'
        );
        const { ReservaSuite } = await import('../../../models/ReservaSuite');
        const { ReservaHospede } = await import('../../../models/ReservaHospede');
        const { calcularNoitesHotelaria } = await import(
            '../../../utils/reservaSuiteUtils'
        );
        const { suiteTemConflito } = await import(
            '../../../services/reservaSuiteService'
        );

        const hospedagem = await ReservaHospedagem.findByPk(idReservaHospedagem, {
            include: [
                {
                    model: ReservaSuite,
                    as: 'ReservaSuite',
                    include: [
                        { model: ReservaHospede, as: 'ReservaHospede' },
                    ],
                },
            ],
        });

        if (!hospedagem) {
            throw new HospedinDomainMappingError(
                `ReservaHospedagem id=${idReservaHospedagem} não encontrada.`,
                'INTERNAL_ENTITY_MISSING'
            );
        }

        const origem = String((hospedagem as any).origemReserva || '');
        if (origem !== 'HOSPEDIN') {
            throw new HospedinDomainMappingError(
                `Reserva Jango origemReserva=${origem || 'null'} — Hospedin não sobrescreve.`,
                'ORIGIN_CONFLICT'
            );
        }

        const suites = ((hospedagem as any).ReservaSuite || []) as any[];
        if (!suites.length) {
            throw new HospedinDomainMappingError(
                'Reserva Jango sem linha de suíte.',
                'PAYLOAD_INCOMPLETE'
            );
        }
        const linha = suites[0];
        const hospedesAtuais = (linha.ReservaHospede || []) as any[];

        const before: ReservationDiffSnapshot = {
            checkin: hospedagem.checkin ? new Date(hospedagem.checkin) : null,
            checkout: hospedagem.checkout
                ? new Date(hospedagem.checkout)
                : null,
            idEventoSuite: Number(linha.idEventoSuite) || null,
            observacoes: (hospedagem as any).observacoes ?? null,
            adultos: Number(linha.adultos || 0),
            criancas: Number(linha.criancas || 0),
            hospedes: hospedesAtuais.map((h) => ({
                nome: String(h.nome || ''),
                tipo: String(h.tipo || ''),
                dataNascimento: h.dataNascimento
                    ? String(h.dataNascimento).slice(0, 10)
                    : null,
            })),
        };

        const diff = reservationDiffService.diff(before, desired);
        const patch = diff.hasChanges
            ? reservationPatchBuilder.buildFromDiff(diff)
            : {};

        let hospedesResolved = patch.hospedesReplace;
        const { guestResolverService } = await import(
            '../../../services/GuestResolverService'
        );
        guestResolverService.clearCache();

        if (patch.hospedesReplace?.length) {
            hospedesResolved = [];
            for (let i = 0; i < patch.hospedesReplace.length; i++) {
                const g = patch.hospedesReplace[i];
                const prev = hospedesAtuais[i];
                const resolved = await guestResolverService.resolveGuest(
                    {
                        nome: g.nome,
                        tipo: g.tipo,
                        dataNascimento: g.dataNascimento,
                        cpf: g.cpf ?? null,
                        email: g.email ?? null,
                        telefone: g.telefone ?? null,
                    },
                    {
                        reservationId: ctx.decision.reservationId,
                        correlationId: ctx.correlationId,
                        previousIdUsuario: prev?.idUsuario ?? null,
                    }
                );
                hospedesResolved.push({
                    ...g,
                    idUsuario: resolved.idUsuario,
                });
            }
        }

        if (diff.hasChanges) {
            await this.applyPatch({
                hospedagem,
                linha,
                patch: {
                    ...patch,
                    hospedesReplace: hospedesResolved,
                },
                suiteTemConflito,
                calcularNoitesHotelaria,
                ReservaHospede,
            });
        }

        // Sempre re-vincula Usuario (ex.: CPF passou a existir na Hospedin).
        const linkChanges = await this.relinkGuestUsuarios({
            hospedagem,
            linha,
            ReservaHospede,
            desired,
            reservationId: ctx.decision.reservationId,
            correlationId: ctx.correlationId,
            guestResolverService,
            skipIfJustReplaced: Boolean(hospedesResolved?.length),
            replacedHospedes: hospedesResolved,
        });

        const { reservationOriginEnrichmentService } = await import(
            './ReservationOriginEnrichmentService'
        );
        await reservationOriginEnrichmentService.enrichFromHospedinStaging({
            idReservaHospedagem,
            staging: ctx.stagingReservation,
            correlationId: ctx.correlationId,
        });

        if (!diff.hasChanges && !linkChanges.length) {
            HospedinLogger.info('update:no_operational_changes', {
                correlation_id: ctx.correlationId,
                reservation_id: ctx.decision.reservationId,
                idReservaHospedagem,
            });
            return {
                idReservaHospedagem,
                applied: false,
                changes: [],
            };
        }

        const changes = [...diff.changes, ...linkChanges];
        HospedinLogger.info('update:applied', {
            correlation_id: ctx.correlationId,
            reservation_id: ctx.decision.reservationId,
            idReservaHospedagem,
            changes,
        });

        return {
            idReservaHospedagem,
            applied: true,
            changes,
        };
    }

    /**
     * Atualiza ReservaHospede.idUsuario / ReservaHospedagem.idUsuario
     * quando o CPF passa a ser válido (sai do usuário técnico).
     */
    private async relinkGuestUsuarios(input: {
        hospedagem: any;
        linha: any;
        ReservaHospede: any;
        desired: ReservationDiffSnapshot;
        reservationId: number;
        correlationId: string;
        guestResolverService: typeof import('../../../services/GuestResolverService').guestResolverService;
        skipIfJustReplaced: boolean;
        replacedHospedes?: Array<{ idUsuario?: number | null; tipo?: string }> | null;
    }): Promise<ReservationDiffChange[]> {
        const changes: ReservationDiffChange[] = [];
        const {
            hospedagem,
            linha,
            ReservaHospede,
            desired,
            reservationId,
            correlationId,
            guestResolverService,
        } = input;

        let rows = ((linha.ReservaHospede || []) as any[]).slice();
        if (input.skipIfJustReplaced && input.replacedHospedes?.length) {
            let titularId: number | null = null;
            for (const g of input.replacedHospedes) {
                const tipo = String(g.tipo || '');
                if (
                    tipo.toLowerCase().includes('adulto') &&
                    g.idUsuario != null &&
                    titularId == null
                ) {
                    titularId = Number(g.idUsuario);
                }
            }
            if (
                titularId != null &&
                Number(hospedagem.idUsuario) !== titularId
            ) {
                const beforeTitular = Number(hospedagem.idUsuario);
                await hospedagem.update({ idUsuario: titularId });
                changes.push({
                    field: 'hospedagem.idUsuario',
                    before: beforeTitular,
                    after: titularId,
                });
            }
            return changes;
        }

        if (input.skipIfJustReplaced) {
            rows = await ReservaHospede.findAll({
                where: { idReservaSuite: Number(linha.id) },
                order: [['id', 'ASC']],
            });
        }

        const desiredGuests = desired.hospedes || [];
        let titularId: number | null = null;

        for (let i = 0; i < desiredGuests.length; i++) {
            const g = desiredGuests[i];
            const row = rows[i];
            const previousId = row?.idUsuario != null ? Number(row.idUsuario) : null;

            const resolved = await guestResolverService.resolveGuest(
                {
                    nome: g.nome,
                    tipo: g.tipo,
                    dataNascimento: g.dataNascimento
                        ? new Date(g.dataNascimento)
                        : null,
                    cpf: g.cpf ?? null,
                    email: g.email ?? null,
                    telefone: g.telefone ?? null,
                },
                {
                    reservationId,
                    correlationId,
                    previousIdUsuario: previousId,
                }
            );

            if (
                String(g.tipo).toLowerCase().includes('adulto') &&
                titularId == null &&
                !resolved.isTechnical
            ) {
                titularId = resolved.idUsuario;
            } else if (
                String(g.tipo).toLowerCase().includes('adulto') &&
                titularId == null
            ) {
                titularId = resolved.idUsuario;
            }

            if (row && previousId !== resolved.idUsuario) {
                await row.update({ idUsuario: resolved.idUsuario });
                changes.push({
                    field: 'hospede.idUsuario',
                    before: previousId,
                    after: resolved.idUsuario,
                });
                HospedinLogger.info('update:guest_usuario_relink', {
                    reservation_id: reservationId,
                    correlation_id: correlationId,
                    hospede: g.nome,
                    before: previousId,
                    after: resolved.idUsuario,
                    action: resolved.action,
                });
            }
        }

        if (titularId != null && Number(hospedagem.idUsuario) !== titularId) {
            const beforeTitular = Number(hospedagem.idUsuario);
            await hospedagem.update({ idUsuario: titularId });
            changes.push({
                field: 'hospedagem.idUsuario',
                before: beforeTitular,
                after: titularId,
            });
            HospedinLogger.info('update:titular_usuario_relink', {
                reservation_id: reservationId,
                correlation_id: correlationId,
                before: beforeTitular,
                after: titularId,
            });
        }

        return changes;
    }

    private async applyPatch(input: {
        hospedagem: any;
        linha: any;
        patch: ReservationPatch;
        suiteTemConflito: typeof import('../../../services/reservaSuiteService').suiteTemConflito;
        calcularNoitesHotelaria: typeof import('../../../utils/reservaSuiteUtils').calcularNoitesHotelaria;
        ReservaHospede: any;
    }) {
        const {
            hospedagem,
            linha,
            patch,
            suiteTemConflito,
            calcularNoitesHotelaria,
            ReservaHospede,
        } = input;

        const checkin = patch.checkin
            ? new Date(patch.checkin)
            : new Date(hospedagem.checkin);
        const checkout = patch.checkout
            ? new Date(patch.checkout)
            : new Date(hospedagem.checkout);
        const idEventoSuite =
            patch.idEventoSuite != null
                ? Number(patch.idEventoSuite)
                : Number(linha.idEventoSuite);

        if (checkout.getTime() <= checkin.getTime()) {
            throw new HospedinDomainMappingError(
                'checkout deve ser posterior ao checkin.',
                'INVALID_DATES'
            );
        }

        const datesOrSuiteChanged =
            patch.checkin != null ||
            patch.checkout != null ||
            patch.idEventoSuite != null;

        if (datesOrSuiteChanged) {
            const conflito = await suiteTemConflito(
                idEventoSuite,
                checkin,
                checkout,
                { excludeReservaHospedagemId: Number(hospedagem.id) }
            );
            if (conflito) {
                throw new HospedinDomainMappingError(
                    'Conflito de disponibilidade na suíte/período ao sincronizar UPDATE.',
                    'SUITE_CONFLICT'
                );
            }
        }

        let noites = Number(hospedagem.noites || 0);
        if (patch.checkin != null || patch.checkout != null) {
            noites = calcularNoitesHotelaria(checkin, checkout);
        }

        await connection.transaction(async (t: Transaction) => {
            const hospedagemPatch: Record<string, unknown> = {};
            if (patch.checkin != null) hospedagemPatch.checkin = checkin;
            if (patch.checkout != null) hospedagemPatch.checkout = checkout;
            if (patch.checkin != null || patch.checkout != null) {
                hospedagemPatch.noites = noites;
            }
            if (patch.observacoes !== undefined) {
                hospedagemPatch.observacoes = patch.observacoes;
            }
            if (Object.keys(hospedagemPatch).length) {
                await hospedagem.update(hospedagemPatch, { transaction: t });
            }

            const suitePatch: Record<string, unknown> = {};
            if (patch.idEventoSuite != null) {
                suitePatch.idEventoSuite = idEventoSuite;
            }
            if (patch.adultos != null) suitePatch.adultos = patch.adultos;
            if (patch.criancas != null) suitePatch.criancas = patch.criancas;
            if (Object.keys(suitePatch).length) {
                await linha.update(suitePatch, { transaction: t });
            }

            if (patch.hospedesReplace) {
                await ReservaHospede.destroy({
                    where: { idReservaSuite: Number(linha.id) },
                    transaction: t,
                });
                for (const g of patch.hospedesReplace) {
                    await ReservaHospede.create(
                        {
                            idReservaSuite: Number(linha.id),
                            nome: g.nome,
                            tipo: g.tipo,
                            dataNascimento: g.dataNascimento ?? null,
                            ...(g.idUsuario != null
                                ? { idUsuario: Number(g.idUsuario) }
                                : {}),
                        },
                        { transaction: t }
                    );
                }
            }
        });
    }
}

export const reservationUpdateService = new ReservationUpdateService();
