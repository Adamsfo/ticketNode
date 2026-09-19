import { Transaction } from 'sequelize';
import connection from '../database';
import {
    ReservaHospedagem,
    StatusReservaHospedagem,
} from '../models/ReservaHospedagem';
import { ReservaSuite, StatusReservaSuite } from '../models/ReservaSuite';
import { EventoSuite } from '../models/EventoSuite';
import { Evento } from '../models/Evento';
import { HistoricoTransacao, Transacao } from '../models/Transacao';
import { HospedinOutboundSyncState } from '../models/HospedinOutboundSyncState';
import { CustomError } from '../utils/customError';
import { gerarTokenPagamentoReserva, suiteTemConflito } from './reservaSuiteService';
import {
    avaliarOutboundReativacao,
    avaliarStatusReativacao,
    avaliarTransacaoReativacao,
    formatarPeriodoConflitoReativacao,
    montarMensagemConflitoReativacao,
    resolverPrazoReativacao,
    type AvaliacaoOutboundReativacao,
    type ReativacaoPrazoPagamento,
} from './hospedagemReativacaoAdminPolicy';

export {
    avaliarOutboundReativacao,
    avaliarStatusReativacao,
    avaliarTransacaoReativacao,
    formatarPeriodoConflitoReativacao,
    montarMensagemConflitoReativacao,
    resolverPrazoReativacao,
    type AvaliacaoOutboundReativacao,
    type ReativacaoPrazoPagamento,
};

export type SuiteReativacaoInput = {
    id: number;
    idEventoSuite: number;
    nomeSuite: string;
    hospedinReservationId?: string | null;
};

export async function listarSuitesIndisponiveisReativacao(params: {
    idReservaHospedagem: number;
    checkin: Date;
    checkout: Date;
    suites: SuiteReativacaoInput[];
}): Promise<Array<{ nomeSuite: string }>> {
    const indisponiveis: Array<{ nomeSuite: string }> = [];

    for (const suite of params.suites) {
        const eventoSuite = await EventoSuite.findByPk(suite.idEventoSuite, {
            attributes: ['id', 'nome', 'status'],
        });

        if (!eventoSuite) {
            indisponiveis.push({
                nomeSuite: suite.nomeSuite || `Suíte ${suite.idEventoSuite}`,
            });
            continue;
        }

        const conflito = await suiteTemConflito(
            suite.idEventoSuite,
            params.checkin,
            params.checkout,
            { excludeReservaHospedagemId: params.idReservaHospedagem }
        );

        if (conflito) {
            indisponiveis.push({
                nomeSuite:
                    eventoSuite.nome ||
                    suite.nomeSuite ||
                    `Suíte ${suite.idEventoSuite}`,
            });
        }
    }

    return indisponiveis;
}

export async function reativarReservaExpiradaAdmin(params: {
    idReservaHospedagem: number;
    idUsuarioOperador: number;
}): Promise<{ id: number; notificacaoEnviada: boolean }> {
    const idReserva = Number(params.idReservaHospedagem);
    const idUsuarioOperador = Number(params.idUsuarioOperador);

    if (!Number.isFinite(idReserva) || idReserva <= 0) {
        throw new CustomError('ID da reserva é obrigatório.', 400, '');
    }
    if (!Number.isFinite(idUsuarioOperador) || idUsuarioOperador <= 0) {
        throw new CustomError('Usuário não autenticado.', 401, '');
    }

    const { obterReservaAdminDetalhe } = await import('./hospedagemAdminService');
    await obterReservaAdminDetalhe(idReserva, idUsuarioOperador);

    const reserva = await ReservaHospedagem.findByPk(idReserva, {
        include: [
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                include: [
                    {
                        model: EventoSuite,
                        as: 'EventoSuite',
                        attributes: ['id', 'nome'],
                        required: false,
                    },
                ],
            },
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'tipo'],
                required: false,
            },
        ],
    });

    if (!reserva) {
        throw new CustomError('Reserva não encontrada.', 404, '');
    }

    const statusAtual = String(reserva.status || '');
    const avaliacaoStatus = avaliarStatusReativacao(statusAtual);
    if (!avaliacaoStatus.ok) {
        throw new CustomError(
            avaliacaoStatus.message,
            avaliacaoStatus.statusCode,
            ''
        );
    }

    const suitesDb =
        (reserva as ReservaHospedagem & {
            ReservaSuite?: Array<
                ReservaSuite & {
                    EventoSuite?: EventoSuite | null;
                }
            >;
        }).ReservaSuite ?? [];

    if (!suitesDb.length) {
        throw new CustomError(
            'Reserva sem suítes vinculadas — não é possível reativar.',
            400,
            ''
        );
    }

    const suitesInput: SuiteReativacaoInput[] = suitesDb.map((suite) => ({
        id: suite.id,
        idEventoSuite: suite.idEventoSuite,
        nomeSuite:
            suite.EventoSuite?.nome ?? `Suíte ${suite.idEventoSuite}`,
        hospedinReservationId: suite.hospedinReservationId ?? null,
    }));

    const checkin = new Date(reserva.checkin);
    const checkout = new Date(reserva.checkout);

    const suitesIndisponiveis = await listarSuitesIndisponiveisReativacao({
        idReservaHospedagem: idReserva,
        checkin,
        checkout,
        suites: suitesInput,
    });

    if (suitesIndisponiveis.length > 0) {
        throw new CustomError(
            montarMensagemConflitoReativacao(
                suitesIndisponiveis,
                formatarPeriodoConflitoReativacao(checkin, checkout)
            ),
            409,
            ''
        );
    }

    const transacao = reserva.idTransacao
        ? await Transacao.findByPk(reserva.idTransacao)
        : null;
    const avaliacaoTransacao = avaliarTransacaoReativacao(transacao);
    if (!avaliacaoTransacao.ok) {
        throw new CustomError(avaliacaoTransacao.message, 400, '');
    }

    const outboundState = await HospedinOutboundSyncState.findOne({
        where: { id_reserva_hospedagem: idReserva },
    });

    const avaliacaoOutbound = avaliarOutboundReativacao({
        origemReserva: reserva.origemReserva ?? null,
        eventoTipo:
            (reserva as ReservaHospedagem & {
                Evento?: { tipo?: string | null } | null;
            }).Evento?.tipo ?? null,
        idExterno: reserva.idExterno ?? null,
        outboundState,
        suites: suitesInput,
    });

    if (!avaliacaoOutbound.ok) {
        throw new CustomError(avaliacaoOutbound.message, 409, '');
    }

    const prazo = resolverPrazoReativacao({
        origemReserva: reserva.origemReserva ?? null,
        tokenPagamento: reserva.tokenPagamento ?? null,
        linkPagamentoEnviadoEm: reserva.linkPagamentoEnviadoEm ?? null,
    });

    const novoToken = prazo.gerarNovoToken
        ? gerarTokenPagamentoReserva()
        : null;

    let notificacaoEnviada = false;

    await connection.transaction(async (t: Transaction) => {
        const reservaLocked = await ReservaHospedagem.findByPk(idReserva, {
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        if (!reservaLocked) {
            throw new CustomError('Reserva não encontrada.', 404, '');
        }

        if (reservaLocked.status === StatusReservaHospedagem.AguardandoPagamento) {
            throw new CustomError(
                'Esta reserva já foi reativada e está aguardando pagamento.',
                409,
                ''
            );
        }

        if (reservaLocked.status !== StatusReservaHospedagem.Expirada) {
            throw new CustomError(
                'Somente reservas expiradas podem ser reativadas.',
                400,
                ''
            );
        }

        const suitesLocked = await ReservaSuite.findAll({
            where: { idReservaHospedagem: idReserva },
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        await reservaLocked.update(
            {
                status: StatusReservaHospedagem.AguardandoPagamento,
                tokenPagamento: prazo.gerarNovoToken ? novoToken : null,
                expiraEm: prazo.expiraEm,
                linkPagamentoEnviadoEm: null,
            },
            { transaction: t }
        );

        for (const suite of suitesLocked) {
            await suite.update(
                { status: StatusReservaSuite.AguardandoPagamento },
                { transaction: t }
            );
        }

        if (reservaLocked.idTransacao) {
            await HistoricoTransacao.create(
                {
                    idTransacao: reservaLocked.idTransacao,
                    idUsuario: idUsuarioOperador,
                    data: new Date(),
                    descricao:
                        'Reserva reativada pelo administrador — aguardando pagamento.',
                },
                { transaction: t }
            );
        }
    });

    if (prazo.gerarNovoToken && novoToken) {
        const { notificarLinkPagamentoHospedagem } = await import(
            './hospedagemConfirmacaoNotificacao'
        );
        await notificarLinkPagamentoHospedagem(idReserva);
        notificacaoEnviada = true;
    }

    if (avaliacaoOutbound.deveMarkDirty) {
        const { hospedinOutboundEnqueueService } = await import(
            '../integrations/hospedin/outbound/HospedinOutboundEnqueueService'
        );
        await hospedinOutboundEnqueueService.markDirty(idReserva);
    }

    const { incrementarHospedagemRefreshVersion } = await import(
        './hospedagemRefreshVersionService'
    );
    await incrementarHospedagemRefreshVersion();

    return { id: idReserva, notificacaoEnviada };
}
