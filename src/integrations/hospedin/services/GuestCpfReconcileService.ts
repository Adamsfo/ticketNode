import { Op } from 'sequelize';
import { ReservaHospedagem } from '../../../models/ReservaHospedagem';
import { ReservaHospede, TipoReservaHospede } from '../../../models/ReservaHospede';
import { ReservaHospedeDocumento } from '../../../models/ReservaHospedeDocumento';
import { ReservaSuite } from '../../../models/ReservaSuite';
import {
    guestResolverService,
    type GuestResolveResult,
} from '../../../services/GuestResolverService';
import { pickGuestCpf } from '../../../utils/guestCpf';
import { logger } from '../../../utils/logger';

export type GuestCpfReconcileItem = {
    idReservaHospede: number;
    idReservaHospedagem: number;
    nome: string;
    beforeIdUsuario: number;
    afterIdUsuario: number;
    cpf: string | null;
    action: GuestResolveResult['action'];
    upgraded: boolean;
};

export type GuestCpfReconcileResult = {
    scanned: number;
    upgraded: number;
    skipped: number;
    failures: number;
    items: GuestCpfReconcileItem[];
};

/**
 * Reconcilia hóspedes vinculados a "HÓSPEDE SEM CPF" que já têm CPF válido
 * em ReservaHospedeDocumento (sem precisar reimportar a reserva).
 */
export class GuestCpfReconcileService {
    async reconcile(options?: {
        limit?: number;
        dryRun?: boolean;
        idReservaHospedagem?: number;
    }): Promise<GuestCpfReconcileResult> {
        const limit = Math.min(Math.max(Number(options?.limit) || 500, 1), 5000);
        const dryRun = Boolean(options?.dryRun);
        const tech = await guestResolverService.ensureTechnicalUsers();
        guestResolverService.clearCache();

        const suiteWhere =
            options?.idReservaHospedagem != null
                ? { idReservaHospedagem: Number(options.idReservaHospedagem) }
                : undefined;

        const hospedes = await ReservaHospede.findAll({
            where: {
                idUsuario: {
                    [Op.in]: [tech.missingId, tech.invalidId],
                },
            },
            include: [
                {
                    model: ReservaHospedeDocumento,
                    as: 'Documentos',
                    required: false,
                },
                {
                    model: ReservaSuite,
                    as: 'ReservaSuite',
                    required: true,
                    ...(suiteWhere ? { where: suiteWhere } : {}),
                    attributes: ['id', 'idReservaHospedagem'],
                },
            ],
            order: [['id', 'ASC']],
            limit,
        });

        const result: GuestCpfReconcileResult = {
            scanned: hospedes.length,
            upgraded: 0,
            skipped: 0,
            failures: 0,
            items: [],
        };

        /** Agrupa titular por reserva para atualizar ReservaHospedagem.idUsuario. */
        const titularByHospedagem = new Map<number, number>();

        for (const hospede of hospedes) {
            const suite = (hospede as any).ReservaSuite as ReservaSuite | undefined;
            const idReservaHospedagem = Number(suite?.idReservaHospedagem || 0);
            const docs = ((hospede as any).Documentos ||
                []) as ReservaHospedeDocumento[];
            const beforeIdUsuario = Number(hospede.idUsuario);

            try {
                const picked = pickGuestCpf({
                    documents: docs.map((d) => ({
                        tipo: d.tipo,
                        numero: d.numero,
                    })),
                });

                if (picked.assessment.status !== 'valid') {
                    result.skipped += 1;
                    result.items.push({
                        idReservaHospede: Number(hospede.id),
                        idReservaHospedagem,
                        nome: String(hospede.nome || ''),
                        beforeIdUsuario,
                        afterIdUsuario: beforeIdUsuario,
                        cpf: null,
                        action: 'TECHNICAL_CPF_MISSING',
                        upgraded: false,
                    });
                    continue;
                }

                if (dryRun) {
                    result.upgraded += 1;
                    result.items.push({
                        idReservaHospede: Number(hospede.id),
                        idReservaHospedagem,
                        nome: String(hospede.nome || ''),
                        beforeIdUsuario,
                        afterIdUsuario: beforeIdUsuario,
                        cpf: picked.assessment.formatted,
                        action: 'CREATED',
                        upgraded: true,
                    });
                    continue;
                }

                const resolved = await guestResolverService.resolveGuest(
                    {
                        nome: String(hospede.nome || 'Hóspede'),
                        tipo: hospede.tipo || TipoReservaHospede.Adulto,
                        dataNascimento: hospede.dataNascimento ?? null,
                        cpf: picked.assessment.formatted,
                        documentos: docs.map((d) => ({
                            tipo: d.tipo,
                            numero: d.numero,
                        })),
                    },
                    {
                        previousIdUsuario: beforeIdUsuario,
                    }
                );

                if (resolved.isTechnical || resolved.idUsuario === beforeIdUsuario) {
                    result.skipped += 1;
                    result.items.push({
                        idReservaHospede: Number(hospede.id),
                        idReservaHospedagem,
                        nome: String(hospede.nome || ''),
                        beforeIdUsuario,
                        afterIdUsuario: resolved.idUsuario,
                        cpf: resolved.cpf,
                        action: resolved.action,
                        upgraded: false,
                    });
                    continue;
                }

                await hospede.update({ idUsuario: resolved.idUsuario });

                const isAdulto =
                    String(hospede.tipo || '')
                        .toLowerCase()
                        .includes('adulto');
                if (isAdulto && idReservaHospedagem > 0) {
                    if (!titularByHospedagem.has(idReservaHospedagem)) {
                        titularByHospedagem.set(
                            idReservaHospedagem,
                            resolved.idUsuario
                        );
                    }
                }

                result.upgraded += 1;
                result.items.push({
                    idReservaHospede: Number(hospede.id),
                    idReservaHospedagem,
                    nome: String(hospede.nome || ''),
                    beforeIdUsuario,
                    afterIdUsuario: resolved.idUsuario,
                    cpf: resolved.cpf,
                    action: resolved.action,
                    upgraded: true,
                });
            } catch (err: any) {
                result.failures += 1;
                logger.error('guest_cpf_reconcile:falha', {
                    idReservaHospede: hospede.id,
                    idReservaHospedagem,
                    message: err?.message,
                    stack: err?.stack,
                });
            }
        }

        if (!dryRun && titularByHospedagem.size) {
            for (const [idHospedagem, idUsuario] of titularByHospedagem) {
                const hospedagem = await ReservaHospedagem.findByPk(idHospedagem);
                if (!hospedagem) continue;
                if (Number(hospedagem.idUsuario) === Number(idUsuario)) continue;
                // Só troca se o responsável atual ainda for o técnico SEM CPF
                // ou se for o mesmo before técnico.
                if (
                    Number(hospedagem.idUsuario) === tech.missingId ||
                    Number(hospedagem.idUsuario) === tech.invalidId
                ) {
                    await hospedagem.update({ idUsuario });
                }
            }
        }

        logger.info('Reconciliação de hóspedes SEM CPF finalizada', {
            scanned: result.scanned,
            upgraded: result.upgraded,
            skipped: result.skipped,
            failures: result.failures,
            dryRun,
        });

        return result;
    }

    /**
     * Após gravar documentos na enrichment: tenta promover hóspedes técnicos
     * daquela reserva que agora tenham CPF válido nos docs.
     */
    async upgradeReservationFromDocuments(
        idReservaHospedagem: number
    ): Promise<GuestCpfReconcileResult> {
        return this.reconcile({
            idReservaHospedagem,
            limit: 50,
            dryRun: false,
        });
    }
}

export const guestCpfReconcileService = new GuestCpfReconcileService();

export async function reconcileGuestCpfFromDocuments(options?: {
    limit?: number;
    dryRun?: boolean;
    idReservaHospedagem?: number;
}): Promise<GuestCpfReconcileResult> {
    return guestCpfReconcileService.reconcile(options);
}
