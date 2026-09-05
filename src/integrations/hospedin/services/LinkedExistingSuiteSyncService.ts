import { Transaction } from 'sequelize';
import connection from '../../../database';
import { HospedinReservation } from '../../../models/HospedinReservation';
import { calcularSaldoPendente } from '../../../utils/hospedagemPagamentoRecepcao';
import { roundMoney } from '../../../utils/reservaSuitePricing';
import { splitOperadorFromTextoCompleto } from '../../../utils/reservaObservacoesUtils';
import { HospedinLogger } from '../logger/HospedinLogger';
import { HospedinReservationDomainMapper } from '../mapper/HospedinReservationDomainMapper';
import { HospedinReservationMapper } from '../mapper/HospedinReservationMapper';
import { extractHospedinOfficialFinance } from '../utils/hospedinOfficialFinance';
import { incrementarHospedagemRefreshVersion } from '../../../services/hospedagemRefreshVersionService';
import { suiteTemConflito } from '../../../services/reservaSuiteService';
import { placeSuiteResolver } from './PlaceSuiteResolver';

export type LinkedExistingAllowedChangesResult = {
    idReservaHospedagem: number;
    applied: boolean;
    skipped?:
        | 'ALREADY_ALIGNED'
        | 'MISSING_RESERVATION'
        | 'MISSING_STAGING'
        | 'INVALID_INTERNAL_ID';
    suiteSkipped?:
        | 'UNMAPPED'
        | 'NO_SUITE_LINE'
        | 'CONFLICT'
        | 'ALREADY_ALIGNED';
    beforeIdEventoSuite?: number | null;
    afterIdEventoSuite?: number | null;
    changes: Array<{ field: string; before: unknown; after: unknown }>;
};

/** @deprecated Use LinkedExistingAllowedChangesResult */
export type LinkedExistingSuiteSyncResult = LinkedExistingAllowedChangesResult;

function normObs(value: string | null | undefined): string {
    return value ?? '';
}

type ObservacaoReplacePatch = {
    observacaoImportada: string | null;
    observacaoOperador: string | null;
    observacoes: string | null;
};

function mergeObservacoesSemConcatImportada(
    importada: string | null,
    operador: string | null
): string | null {
    if (!importada && !operador) return null;
    if (!importada) return operador;
    if (!operador) return importada;
    return `${importada}\n\n${operador}`;
}

/**
 * Substitui observacaoImportada pelo valor Hospedin (sem concatenar com a anterior)
 * e reconstrói observacoes preservando observacaoOperador.
 */
function buildLinkedExistingObservacaoReplace(
    hospedagem: {
        observacaoImportada?: string | null;
        observacaoOperador?: string | null;
        observacoes?: string | null;
    },
    novaImportada: string | null
): ObservacaoReplacePatch {
    const importadaAnterior = hospedagem.observacaoImportada ?? null;
    const operadorPreservado = hospedagem.observacaoOperador ?? null;

    let operadorParaMerge = operadorPreservado;
    if (
        (operadorParaMerge == null || operadorParaMerge === '') &&
        hospedagem.observacoes &&
        importadaAnterior
    ) {
        operadorParaMerge = splitOperadorFromTextoCompleto(
            hospedagem.observacoes,
            importadaAnterior
        ).observacaoOperador;
    }

    const importada = novaImportada ?? null;
    return {
        observacaoImportada: importada,
        observacaoOperador: operadorPreservado,
        observacoes: mergeObservacoesSemConcatImportada(
            importada,
            operadorParaMerge
        ),
    };
}

function podeEspelharValorNaSuiteLinha(linha: {
    descontoTipo?: string | null;
    descontoValor?: number | null;
}): boolean {
    const descontoTipo = linha.descontoTipo;
    if (descontoTipo != null && String(descontoTipo).trim() !== '') {
        return false;
    }
    const descontoValor = Number(linha.descontoValor ?? 0);
    if (Number.isFinite(descontoValor) && descontoValor > 0.009) {
        return false;
    }
    return true;
}

function readStagingPayload(staging: HospedinReservation): Record<string, unknown> | null {
    const raw = staging.payload_json;
    if (!raw) return null;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw) as Record<string, unknown>;
        } catch {
            return null;
        }
    }
    return raw as Record<string, unknown>;
}

/**
 * Para reservas LINKED_EXISTING (origem local ≠ HOSPEDIN): sincroniza somente
 * suíte, valor total e observação importada quando divergirem do Hospedin.
 * Não altera demais campos da reserva local (pagamentos, datas, hóspedes, etc.).
 */
export class LinkedExistingSuiteSyncService {
    async syncLinkedExistingAllowedChanges(input: {
        reservationId: number;
        internalEntityId?: string | number | null;
        correlationId?: string | null;
    }): Promise<LinkedExistingAllowedChangesResult> {
        const reservationId = Number(input.reservationId);
        const idReservaHospedagem = Number(input.internalEntityId);
        const emptyChanges: LinkedExistingAllowedChangesResult['changes'] = [];

        if (!Number.isFinite(idReservaHospedagem) || idReservaHospedagem <= 0) {
            return {
                idReservaHospedagem: 0,
                applied: false,
                skipped: 'INVALID_INTERNAL_ID',
                changes: emptyChanges,
            };
        }

        const staging = await HospedinReservation.findOne({
            where: { reservation_id: reservationId },
        });
        if (!staging) {
            return {
                idReservaHospedagem,
                applied: false,
                skipped: 'MISSING_STAGING',
                changes: emptyChanges,
            };
        }

        const payload = readStagingPayload(staging) || {};
        const dto = HospedinReservationMapper.toDto({
            ...(payload || {}),
            id: payload?.id ?? staging.reservation_id,
            status: payload?.status ?? staging.status,
            check_in: payload?.check_in ?? staging.checkin,
            check_out: payload?.check_out ?? staging.checkout,
            place_id: payload?.place_id,
            place_type_id: payload?.place_type_id,
            searchable_code: payload?.searchable_code,
        });

        const { ReservaHospedagem } = await import(
            '../../../models/ReservaHospedagem'
        );
        const { ReservaSuite } = await import('../../../models/ReservaSuite');

        const hospedagem = await ReservaHospedagem.findByPk(idReservaHospedagem, {
            include: [{ model: ReservaSuite, as: 'ReservaSuite' }],
        });

        if (!hospedagem) {
            return {
                idReservaHospedagem,
                applied: false,
                skipped: 'MISSING_RESERVATION',
                changes: emptyChanges,
            };
        }

        const suites = ((hospedagem as any).ReservaSuite || []) as any[];
        const linha = suites[0] ?? null;
        const changes: LinkedExistingAllowedChangesResult['changes'] = [];
        let suiteSkipped: LinkedExistingAllowedChangesResult['suiteSkipped'];
        let beforeIdEventoSuite: number | null | undefined;
        let afterIdEventoSuite: number | null | undefined;
        let suitePatch: Record<string, unknown> | null = null;

        const resolved = await placeSuiteResolver.resolveInternalSuite(
            dto.placeId
        );

        if (!resolved.found) {
            suiteSkipped = 'UNMAPPED';
            HospedinLogger.debug('linked_existing:suite_sync_skipped', {
                reservation_id: reservationId,
                correlation_id: input.correlationId,
                idReservaHospedagem,
                reason: resolved.status,
                message: resolved.message,
            });
        } else if (!linha) {
            suiteSkipped = 'NO_SUITE_LINE';
        } else {
            beforeIdEventoSuite = Number(linha.idEventoSuite) || null;
            afterIdEventoSuite = Number(resolved.idEventoSuite);

            if (beforeIdEventoSuite === afterIdEventoSuite) {
                suiteSkipped = 'ALREADY_ALIGNED';
            } else {
                const checkin = new Date(hospedagem.checkin);
                const checkout = new Date(hospedagem.checkout);
                const conflito = await suiteTemConflito(afterIdEventoSuite, checkin, checkout, {
                    excludeReservaHospedagemId: idReservaHospedagem,
                });
                if (conflito) {
                    suiteSkipped = 'CONFLICT';
                    HospedinLogger.warn('linked_existing:suite_sync_conflict', {
                        reservation_id: reservationId,
                        correlation_id: input.correlationId,
                        idReservaHospedagem,
                        beforeIdEventoSuite,
                        afterIdEventoSuite,
                    });
                } else {
                    suitePatch = { idEventoSuite: afterIdEventoSuite };
                    changes.push({
                        field: 'idEventoSuite',
                        before: beforeIdEventoSuite,
                        after: afterIdEventoSuite,
                    });
                }
            }
        }

        const finance = extractHospedinOfficialFinance(payload);
        const valorPagoAtual = roundMoney(Number(hospedagem.valorPago ?? 0));
        let novoValorTotal: number | null = null;

        if (finance) {
            novoValorTotal = finance.valorTotal;
            const valorTotalAtual = roundMoney(Number(hospedagem.valorTotal ?? 0));
            if (valorTotalAtual !== novoValorTotal) {
                const novoSaldo = calcularSaldoPendente(
                    novoValorTotal,
                    valorPagoAtual
                );
                const saldoAtual = roundMoney(
                    Number(hospedagem.saldoPendente ?? 0)
                );
                changes.push({
                    field: 'valorTotal',
                    before: valorTotalAtual,
                    after: novoValorTotal,
                });
                if (saldoAtual !== novoSaldo) {
                    changes.push({
                        field: 'saldoPendente',
                        before: saldoAtual,
                        after: novoSaldo,
                    });
                }
            }
        }

        const novaObservacaoImportada =
            HospedinReservationDomainMapper.buildObservacoesFromStaging(staging);
        const observacaoImportadaAtual =
            (hospedagem as any).observacaoImportada ?? null;

        let observacaoPatch: ObservacaoReplacePatch | null = null;

        if (
            normObs(observacaoImportadaAtual) !==
            normObs(novaObservacaoImportada)
        ) {
            observacaoPatch = buildLinkedExistingObservacaoReplace(
                hospedagem as {
                    observacaoImportada?: string | null;
                    observacaoOperador?: string | null;
                    observacoes?: string | null;
                },
                novaObservacaoImportada
            );
            changes.push({
                field: 'observacaoImportada',
                before: observacaoImportadaAtual,
                after: observacaoPatch.observacaoImportada,
            });
            const observacoesAntes = (hospedagem as any).observacoes ?? null;
            if (observacoesAntes !== observacaoPatch.observacoes) {
                changes.push({
                    field: 'observacoes',
                    before: observacoesAntes,
                    after: observacaoPatch.observacoes,
                });
            }
        }

        if (changes.length === 0) {
            return {
                idReservaHospedagem,
                applied: false,
                skipped: 'ALREADY_ALIGNED',
                suiteSkipped,
                beforeIdEventoSuite,
                afterIdEventoSuite,
                changes: emptyChanges,
            };
        }

        const hospedagemPatch: Record<string, unknown> = {};
        if (novoValorTotal != null) {
            const valorTotalChange = changes.find((c) => c.field === 'valorTotal');
            if (valorTotalChange) {
                hospedagemPatch.valorTotal = novoValorTotal;
                hospedagemPatch.saldoPendente = calcularSaldoPendente(
                    novoValorTotal,
                    valorPagoAtual
                );
            }
        }
        if (observacaoPatch) {
            Object.assign(hospedagemPatch, observacaoPatch);
        }

        const suiteValorPatch: Record<string, unknown> = {};
        if (
            novoValorTotal != null &&
            changes.some((c) => c.field === 'valorTotal') &&
            suites.length === 1 &&
            linha &&
            podeEspelharValorNaSuiteLinha(linha)
        ) {
            const suiteValorAtual = roundMoney(Number(linha.valorTotal ?? 0));
            if (suiteValorAtual !== novoValorTotal) {
                suiteValorPatch.valorTotal = novoValorTotal;
                suiteValorPatch.preco = novoValorTotal;
                suiteValorPatch.valorFinal = novoValorTotal;
                changes.push({
                    field: 'ReservaSuite.valorTotal',
                    before: suiteValorAtual,
                    after: novoValorTotal,
                });
            }
        }

        await connection.transaction(async (transaction: Transaction) => {
            if (Object.keys(hospedagemPatch).length > 0) {
                await hospedagem.update(hospedagemPatch, { transaction });
            }
            if (suitePatch && linha) {
                await linha.update(suitePatch, { transaction });
            }
            if (Object.keys(suiteValorPatch).length > 0 && linha) {
                await linha.update(suiteValorPatch, { transaction });
            }
        });

        await incrementarHospedagemRefreshVersion();

        HospedinLogger.info('linked_existing:allowed_changes_applied', {
            reservation_id: reservationId,
            correlation_id: input.correlationId,
            idReservaHospedagem,
            place_id: resolved.found ? resolved.placeId : dto.placeId,
            beforeIdEventoSuite,
            afterIdEventoSuite,
            suiteSkipped,
            changes,
        });

        return {
            idReservaHospedagem,
            applied: true,
            suiteSkipped,
            beforeIdEventoSuite,
            afterIdEventoSuite,
            changes,
        };
    }

    /** @deprecated Use syncLinkedExistingAllowedChanges */
    async syncSuiteIfChanged(input: {
        reservationId: number;
        internalEntityId?: string | number | null;
        correlationId?: string | null;
    }): Promise<LinkedExistingAllowedChangesResult> {
        return this.syncLinkedExistingAllowedChanges(input);
    }
}

export const linkedExistingSuiteSyncService =
    new LinkedExistingSuiteSyncService();
