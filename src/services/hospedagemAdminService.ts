import { Op, Sequelize, Transaction, WhereOptions } from 'sequelize';
import { fromZonedTime, toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { startOfDay, endOfDay } from 'date-fns';
import connection from '../database';
import { Evento } from '../models/Evento';
import { EventoSuite } from '../models/EventoSuite';
import {
    ReservaHospedagem,
    StatusReservaHospedagem,
    type OrigemReservaHospedagem,
} from '../models/ReservaHospedagem';
import { ReservaSuite, StatusReservaSuite } from '../models/ReservaSuite';
import { ReservaHospede } from '../models/ReservaHospede';
import { PagamentoHospedagem } from '../models/PagamentoHospedagem';
import { ProdutorAcesso } from '../models/Produtor';
import { Usuario } from '../models/Usuario';
import {
    Transacao,
    HistoricoTransacao,
} from '../models/Transacao';
import { CustomError } from '../utils/customError';
import {
    calcularExtrasPousada,
    toNumber,
    calcularNoitesHotelaria,
} from '../utils/reservaSuiteUtils';
import {
    calcularDisponibilidadeSuite,
    calcularDisponibilidadePeriodo,
    calcularAcoesOperacionaisDaReserva,
    classificarReservaNoDia,
    type BadgeSuiteDisponibilidade,
    type ReservaDisponibilidadeInput,
    type StatusReservaDisponibilidade,
} from './suiteDisponibilidadeService';
import {
    calcularSaldoPendente,
    labelFormaPagamentoRecepcao,
} from '../utils/hospedagemPagamentoRecepcao';
import {
    montarUrlPublicaReserva,
    notificarLinkPagamentoHospedagem,
} from './hospedagemConfirmacaoNotificacao';
import {
    ReservaSuiteMovimentacao,
    TipoMovimentacaoSuite,
} from '../models/ReservaSuiteMovimentacao';
import {
    ReservaPeriodoMovimentacao,
    TipoMovimentacaoPeriodo,
} from '../models/ReservaPeriodoMovimentacao';

function resolverOrigemReserva(
    reserva: ReservaHospedagem & {
        origemReserva?: OrigemReservaHospedagem | string | null;
        idUsuarioCriacao?: number | null;
        formaPagamentoRecepcao?: string | null;
        comprovantePagamento?: string | null;
        observacaoPagamento?: string | null;
        valorPago?: number;
    },
    temPagamentoHospedagem = false
): string {
    const raw = String(reserva.origemReserva || '').toUpperCase();
    // Integrações / canais externos: preservar o valor real (não colapsar).
    if (raw === 'HOSPEDIN') return 'HOSPEDIN';
    if (
        raw === 'BOOKING' ||
        raw === 'AIRBNB' ||
        raw === 'EXPEDIA' ||
        raw === 'TELEFONE' ||
        raw === 'BALCAO' ||
        raw === 'BALCÃO'
    ) {
        return raw === 'BALCÃO' ? 'BALCAO' : raw;
    }
    // Produção local: CLIENTE | ATENDENTE. SITE = legado (tratado como CLIENTE na UI).
    if (reserva.origemReserva === 'ATENDENTE') {
        return 'ATENDENTE';
    }
    if (
        temPagamentoHospedagem ||
        Number(reserva.idUsuarioCriacao ?? 0) > 0 ||
        reserva.formaPagamentoRecepcao ||
        reserva.comprovantePagamento ||
        reserva.observacaoPagamento ||
        toNumber(reserva.valorPago) > 0
    ) {
        return 'ATENDENTE';
    }
    return 'CLIENTE';
}

function centsToNumber(cents: number | null | undefined): number | null {
    if (cents == null || !Number.isFinite(Number(cents))) return null;
    return Number(cents) / 100;
}

/** Metadados multi-provedor (Fase 1) para auditoria no modal admin. */
async function carregarOrigemIntegracao(idReservaHospedagem: number) {
    const { ReservaIdentificadorExterno } = await import(
        '../models/ReservaIdentificadorExterno'
    );
    const { ReservaOrigemFinanceira } = await import(
        '../models/ReservaOrigemFinanceira'
    );
    const { ReservaOrigemPayload } = await import(
        '../models/ReservaOrigemPayload'
    );
    const { ReservaHospedeDocumento } = await import(
        '../models/ReservaHospedeDocumento'
    );

    const [identificadores, financeira, payloads, suiteRows] =
        await Promise.all([
            ReservaIdentificadorExterno.findAll({
                where: { idReservaHospedagem },
                order: [['id', 'ASC']],
            }),
            ReservaOrigemFinanceira.findOne({
                where: { idReservaHospedagem },
            }),
            ReservaOrigemPayload.findAll({
                where: { idReservaHospedagem },
                order: [['capturedAt', 'DESC']],
            }),
            ReservaSuite.findAll({
                where: { idReservaHospedagem },
                attributes: ['id'],
            }),
        ]);

    const suiteIds = suiteRows.map((s) => s.id);
    const hospedes =
        suiteIds.length > 0
            ? await ReservaHospede.findAll({
                  where: { idReservaSuite: { [Op.in]: suiteIds } },
                  attributes: ['id', 'nome', 'tipo'],
                  order: [['id', 'ASC']],
              })
            : [];
    const hospedeIds = hospedes.map((h) => h.id);
    const docs =
        hospedeIds.length > 0
            ? await ReservaHospedeDocumento.findAll({
                  where: { idReservaHospede: { [Op.in]: hospedeIds } },
                  order: [['id', 'ASC']],
              })
            : [];

    const hospedePorId = new Map(hospedes.map((h) => [h.id, h]));
    const documentos = docs.map((d) => {
        const h = hospedePorId.get(d.idReservaHospede);
        return {
            id: d.id,
            idReservaHospede: d.idReservaHospede,
            hospedeNome: h?.nome ?? null,
            hospedeTipo: h?.tipo ?? null,
            provider: d.provider ?? null,
            tipo: d.tipo,
            numero: d.numero,
            paisEmissao: d.paisEmissao ?? null,
            observacao: d.observacao ?? null,
        };
    });

    const fin = financeira
        ? {
              provider: financeira.provider,
              moeda: financeira.moeda ?? null,
              total: centsToNumber(financeira.totalCents),
              received: centsToNumber(financeira.receivedCents),
              toReceive: centsToNumber(financeira.toReceiveCents),
              daily: centsToNumber(financeira.dailyCents),
              totalDaily: centsToNumber(financeira.totalDailyCents),
              discount: centsToNumber(financeira.discountCents),
              product: centsToNumber(financeira.productCents),
              service: centsToNumber(financeira.serviceCents),
              itemsCount: financeira.itemsCount ?? null,
              paymentFromOta: financeira.paymentFromOta ?? null,
              statusPagamento: financeira.statusPagamento ?? null,
              formaPagamento: financeira.formaPagamento ?? null,
              origemPagamento: financeira.origemPagamento ?? null,
              responsavelPagamento: financeira.responsavelPagamento ?? null,
              syncedAt: financeira.syncedAt,
              aviso: 'Auditoria da origem. O financeiro operacional da reserva (aba Operação) espelha estes valores enquanto a origem for Hospedin.',
          }
        : null;

    const payloadsOut = payloads.map((p) => ({
        id: p.id,
        provider: p.provider,
        kind: p.kind,
        externalId: p.externalId ?? null,
        payloadHash: p.payloadHash,
        capturedAt: p.capturedAt,
        payloadJson: p.payloadJson,
    }));

    let ultimaSincronizacao: Date | null = null;
    const candidatos: Date[] = [];
    if (financeira?.syncedAt) candidatos.push(new Date(financeira.syncedAt));
    for (const p of payloads) {
        if (p.capturedAt) candidatos.push(new Date(p.capturedAt));
    }
    if (candidatos.length > 0) {
        ultimaSincronizacao = new Date(
            Math.max(...candidatos.map((d) => d.getTime()))
        );
    }

    return {
        identificadores: identificadores.map((i) => ({
            id: i.id,
            provider: i.provider,
            tipo: i.tipo,
            valor: i.valor,
        })),
        financeira: fin,
        documentos,
        payloads: payloadsOut,
        ultimaSincronizacao,
    };
}

/** Consolida valor pago / saldo (colunas denormalizadas ou soma de PagamentoHospedagem). */
function resolverFinanceiroReserva(
    rh: ReservaHospedagem & {
        valorPago?: number;
        saldoPendente?: number | null;
        Pagamentos?: Array<{ valor?: number }>;
    }
): { valorPago: number; saldoPendente: number } {
    const valorTotal = toNumber(rh.valorTotal);
    const somaPagamentos = (rh.Pagamentos ?? []).reduce(
        (acc, p) => acc + toNumber(p.valor),
        0
    );
    const valorPagoColuna = toNumber(rh.valorPago ?? 0);
    const valorPago =
        valorPagoColuna > 0 ? valorPagoColuna : toNumber(somaPagamentos);
    const saldoCalculado = calcularSaldoPendente(valorTotal, valorPago);

    const saldoColuna =
        rh.saldoPendente != null && rh.saldoPendente !== undefined
            ? toNumber(rh.saldoPendente)
            : null;

    // Usa a coluna denormalizada só se estiver coerente com valor_total - valor_pago.
    // Evita exibir R$ 0,00 quando saldo_pendente ficou desatualizado no banco.
    const colunaConfiavel =
        saldoColuna != null &&
        !(valorPagoColuna <= 0 && somaPagamentos > 0) &&
        Math.abs(saldoColuna - saldoCalculado) <= 0.009;

    const saldoPendente = colunaConfiavel ? saldoColuna! : saldoCalculado;

    return { valorPago, saldoPendente };
}

const TZ = 'America/Cuiaba';
const PAGE_SIZE_DEFAULT = 20;

export type FiltroReservasAdmin =
    | 'hoje'
    | 'checkin'
    | 'hospedados'
    | 'checkout'
    | 'checkout_realizado'
    | 'aguardando_pagamento'
    | 'pendentes'
    | 'confirmadas'
    | 'canceladas'
    | 'expiradas'
    | 'online'
    | 'atendente'
    | 'sync_erro'
    | 'todos'
    | '';

export type OrdenacaoReservasAdmin =
    | 'recentes'
    | 'antigas'
    | 'checkin'
    | 'checkout'
    | 'nome';

type UsuarioResumo = {
    nomeCompleto?: string | null;
    telefone?: string | null;
    email?: string | null;
};

type SuiteComEvento = ReservaSuite & {
    EventoSuite?: Pick<EventoSuite, 'nome'> | null;
};

type ReservaComIncludes = ReservaHospedagem & {
    Usuario?: UsuarioResumo | null;
    UsuarioCriacao?: UsuarioResumo | null;
    Evento?: { id: number; nome: string; idProdutor?: number } | null;
    ReservaSuite?: SuiteComEvento[];
    Transacao?: Transacao | null;
    createdAt?: Date;
};

function boundsHojeCuiaba(agora = new Date()): { inicio: Date; fim: Date; agoraLocal: Date } {
    const agoraLocal = toZonedTime(agora, TZ);
    const inicioLocal = startOfDay(agoraLocal);
    const fimLocal = endOfDay(agoraLocal);
    return {
        inicio: fromZonedTime(inicioLocal, TZ),
        fim: fromZonedTime(fimLocal, TZ),
        agoraLocal,
    };
}

/** Status para exibição: Confirmada/Hospedada com checkout já passado → CheckOutRealizado. */
export function statusExibicaoReserva(
    status: string,
    checkout: Date | string
): string {
    if (status === StatusReservaHospedagem.CheckOutRealizado) {
        return 'CheckOutRealizado';
    }
    if (
        status === StatusReservaHospedagem.Confirmada ||
        status === StatusReservaHospedagem.Hospedada
    ) {
        const fim = checkout instanceof Date ? checkout : new Date(checkout);
        if (!Number.isNaN(fim.getTime()) && fim.getTime() < Date.now()) {
            return 'CheckOutRealizado';
        }
    }
    return status;
}

async function resolverEscopoProdutor(idUsuario: number): Promise<{
    admGeral: boolean;
    idsProdutor: number[];
}> {
    const usuario = await Usuario.findByPk(idUsuario, {
        attributes: ['id', 'admGeral'],
    });

    if (!usuario) {
        throw new CustomError('Usuário não autenticado.', 401, '');
    }

    if (usuario.admGeral) {
        return { admGeral: true, idsProdutor: [] };
    }

    const acessos = await ProdutorAcesso.findAll({
        where: { idUsuario },
        attributes: ['idProdutor'],
    });

    const idsProdutor = [
        ...new Set(
            acessos
                .map((a) => Number(a.idProdutor))
                .filter((id) => Number.isFinite(id) && id > 0)
        ),
    ];

    if (idsProdutor.length === 0) {
        throw new CustomError(
            'Usuário sem acesso a produtores de hospedagem.',
            403,
            ''
        );
    }

    return { admGeral: false, idsProdutor };
}

function montarWhereFiltro(
    filtro: FiltroReservasAdmin
): WhereOptions | undefined {
    const { inicio, fim } = boundsHojeCuiaba();
    const agora = new Date();

    switch (filtro) {
        case 'hoje':
            return {
                [Op.or]: [
                    { checkin: { [Op.between]: [inicio, fim] } },
                    { checkout: { [Op.between]: [inicio, fim] } },
                    {
                        [Op.and]: [
                            {
                                status: {
                                    [Op.in]: [
                                        StatusReservaHospedagem.Confirmada,
                                        StatusReservaHospedagem.Hospedada,
                                    ],
                                },
                            },
                            { checkin: { [Op.lte]: agora } },
                            { checkout: { [Op.gt]: agora } },
                        ],
                    },
                ],
            };
        case 'checkin':
            return { checkin: { [Op.between]: [inicio, fim] } };
        case 'checkout':
            return { checkout: { [Op.between]: [inicio, fim] } };
        case 'hospedados':
            return {
                status: {
                    [Op.in]: [
                        StatusReservaHospedagem.Confirmada,
                        StatusReservaHospedagem.Hospedada,
                    ],
                },
                checkin: { [Op.lte]: agora },
                checkout: { [Op.gt]: agora },
            };
        case 'aguardando_pagamento':
        case 'pendentes':
            return { status: StatusReservaHospedagem.AguardandoPagamento };
        case 'confirmadas':
            return {
                status: {
                    [Op.in]: [
                        StatusReservaHospedagem.Confirmada,
                        StatusReservaHospedagem.Hospedada,
                    ],
                },
            };
        case 'canceladas':
            return { status: StatusReservaHospedagem.Cancelada };
        case 'expiradas':
            return { status: StatusReservaHospedagem.Expirada };
        case 'checkout_realizado':
            return {
                [Op.or]: [
                    { status: StatusReservaHospedagem.CheckOutRealizado },
                    {
                        status: {
                            [Op.in]: [
                                StatusReservaHospedagem.Confirmada,
                                StatusReservaHospedagem.Hospedada,
                            ],
                        },
                        checkout: { [Op.lt]: agora },
                    },
                ],
            };
        case 'online':
            return {
                [Op.or]: [
                    { origemReserva: 'CLIENTE' },
                    { origemReserva: 'SITE' },
                    { origemReserva: { [Op.is]: null } },
                ],
            };
        case 'atendente':
            return { origemReserva: 'ATENDENTE' };
        case 'todos':
        case '':
        default:
            return undefined;
    }
}

function montarOrder(
    ordenacao: OrdenacaoReservasAdmin
): Array<[string | ReturnType<typeof Sequelize.col>, string]> {
    switch (ordenacao) {
        case 'antigas':
            return [['id', 'ASC']];
        case 'checkin':
            return [['checkin', 'ASC'], ['id', 'DESC']];
        case 'checkout':
            return [['checkout', 'ASC'], ['id', 'DESC']];
        case 'nome':
            return [
                [Sequelize.col('Usuario.nomeCompleto'), 'ASC'],
                ['id', 'DESC'],
            ];
        case 'recentes':
        default:
            return [['id', 'DESC']];
    }
}

function mapearResumoLista(reserva: ReservaComIncludes) {
    const suites = reserva.ReservaSuite ?? [];
    const suitesResumo = suites.map((suite) => ({
        nome: suite.EventoSuite?.nome ?? `Suíte ${suite.idEventoSuite}`,
        quantidade: 1,
        adultos: suite.adultos,
        criancas: suite.criancas,
        preco: toNumber(suite.preco),
    }));

    const totalAdultos = suites.reduce((acc, s) => acc + Number(s.adultos || 0), 0);
    const totalCriancas = suites.reduce(
        (acc, s) => acc + Number(s.criancas || 0),
        0
    );

    const status = statusExibicaoReserva(reserva.status, reserva.checkout);
    const financeiro = resolverFinanceiroReserva(
        reserva as ReservaHospedagem & {
            valorPago?: number;
            saldoPendente?: number | null;
            Pagamentos?: Array<{ valor?: number }>;
        }
    );
    const origemReserva = resolverOrigemReserva(
        reserva as ReservaHospedagem & {
            origemReserva?: OrigemReservaHospedagem | string | null;
            idUsuarioCriacao?: number | null;
            formaPagamentoRecepcao?: string | null;
            comprovantePagamento?: string | null;
            observacaoPagamento?: string | null;
            valorPago?: number;
        },
        financeiro.valorPago > 0
    );

    return {
        idReservaHospedagem: reserva.id,
        numeroReserva: reserva.id,
        status,
        statusOriginal: reserva.status,
        checkin: reserva.checkin,
        checkout: reserva.checkout,
        noites: reserva.noites,
        valorTotal: toNumber(reserva.valorTotal),
        valorPago: financeiro.valorPago,
        saldoPendente: financeiro.saldoPendente,
        formaPagamentoRecepcao:
            (reserva as ReservaHospedagem & {
                formaPagamentoRecepcao?: string | null;
            }).formaPagamentoRecepcao ?? null,
        origemReserva,
        idUsuarioCriacao:
            (reserva as ReservaHospedagem & {
                idUsuarioCriacao?: number | null;
            }).idUsuarioCriacao ?? null,
        nomeUsuarioCriacao:
            (reserva as ReservaComIncludes).UsuarioCriacao?.nomeCompleto ?? null,
        dataCriacao:
            (reserva as ReservaComIncludes).createdAt ??
            reserva.dataConfirmacao ??
            null,
        taxaServico: toNumber(reserva.taxaServico),
        preco: toNumber(reserva.preco),
        nomeResponsavel: reserva.Usuario?.nomeCompleto ?? '—',
        telefone: reserva.Usuario?.telefone ?? null,
        email: reserva.Usuario?.email ?? null,
        quantidadeSuites: suites.length,
        totalAdultos,
        totalCriancas,
        suites: suitesResumo,
        // Campos de conveniência para o card (layout atual)
        nomeSuite: suitesResumo[0]?.nome ?? 'Suíte',
        adultos: totalAdultos,
        criancas: totalCriancas,
        responsavel: reserva.Usuario?.nomeCompleto ?? '—',
        id: reserva.id,
        dataHoraCheckinReal:
            (reserva as ReservaHospedagem & {
                dataHoraCheckinReal?: Date | null;
            }).dataHoraCheckinReal ?? null,
        dataHoraCheckoutRealizado:
            (reserva as ReservaHospedagem & {
                dataHoraCheckoutRealizado?: Date | null;
            }).dataHoraCheckoutRealizado ?? null,
        idUsuarioCheckout:
            (reserva as ReservaHospedagem & {
                idUsuarioCheckout?: number | null;
            }).idUsuarioCheckout ?? null,
    };
}

export async function listarReservasAdmin(params: {
    idUsuario: number;
    busca?: string;
    filtro?: string;
    ordenacao?: string;
    page?: number;
    pageSize?: number;
}) {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(
        100,
        Math.max(1, Number(params.pageSize) || PAGE_SIZE_DEFAULT)
    );
    const filtro = (params.filtro || 'todos') as FiltroReservasAdmin;
    const ordenacao = (params.ordenacao || 'recentes') as OrdenacaoReservasAdmin;
    const busca = (params.busca || '').trim();

    const escopo = await resolverEscopoProdutor(params.idUsuario);

    const whereFiltro = montarWhereFiltro(filtro);
    const whereReserva: WhereOptions = {
        ...(whereFiltro || {}),
    };

    if (filtro === 'sync_erro') {
        const { findInternalIdsWithSyncError } = await import(
            '../integrations/core/SyncMonitorService'
        );
        const idsErro = await findInternalIdsWithSyncError(1000);
        if (idsErro.length === 0) {
            return {
                data: [],
                meta: {
                    page,
                    pageSize,
                    total: 0,
                    totalPages: 0,
                    hasMore: false,
                    filtro,
                    ordenacao,
                    busca: busca || null,
                },
            };
        }
        (whereReserva as any).id = { [Op.in]: idsErro };
    }

    if (busca) {
        const like = `%${busca}%`;
        const orBusca: any[] = [
            Sequelize.where(
                Sequelize.cast(Sequelize.col('ReservaHospedagem.id'), 'CHAR'),
                { [Op.like]: like }
            ),
            { '$Usuario.nomeCompleto$': { [Op.like]: like } },
            { '$Usuario.telefone$': { [Op.like]: like } },
            { '$Usuario.email$': { [Op.like]: like } },
            Sequelize.literal(
                `EXISTS (
                    SELECT 1
                    FROM ReservaHospede AS rh
                    INNER JOIN ReservaSuite AS rs ON rs.id = rh.idReservaSuite
                    WHERE rs.idReservaHospedagem = ReservaHospedagem.id
                      AND rh.nome LIKE ${connection.escape(like)}
                )`
            ),
        ];
        (whereReserva as any)[Op.and] = [
            ...((whereReserva as any)[Op.and] || []),
            { [Op.or]: orBusca },
        ];
    }

    const eventoWhere: WhereOptions = {
        tipo: 'Pousada',
        ...(escopo.admGeral ? {} : { idProdutor: { [Op.in]: escopo.idsProdutor } }),
    };

    const { rows, count } = await ReservaHospedagem.findAndCountAll({
        where: whereReserva,
        include: [
            {
                model: Usuario,
                as: 'Usuario',
                attributes: ['id', 'nomeCompleto', 'telefone', 'email'],
                required: false,
            },
            {
                model: Usuario,
                as: 'UsuarioCriacao',
                attributes: ['id', 'nomeCompleto'],
                required: false,
            },
            {
                model: PagamentoHospedagem,
                as: 'Pagamentos',
                attributes: ['id', 'valor', 'formaPagamento', 'dataPagamento'],
                required: false,
            },
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'nome', 'idProdutor'],
                where: eventoWhere,
                required: true,
            },
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                attributes: [
                    'id',
                    'idEventoSuite',
                    'adultos',
                    'criancas',
                    'preco',
                    'taxaServico',
                    'valorTotal',
                    'status',
                ],
                required: false,
                include: [
                    {
                        model: EventoSuite,
                        as: 'EventoSuite',
                        attributes: ['id', 'nome'],
                        required: false,
                    },
                ],
            },
        ],
        order: montarOrder(ordenacao) as any,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        distinct: true,
        subQuery: false,
    });

    const data = (rows as ReservaComIncludes[]).map(mapearResumoLista);

    const { getSyncStatesByInternalIds } = await import(
        '../integrations/core/SyncMonitorService'
    );
    const syncMap = await getSyncStatesByInternalIds(
        data.map((d) => d.idReservaHospedagem)
    );
    const dataComSync = data.map((d) => {
        const sync = syncMap.get(String(d.idReservaHospedagem));
        if (!sync) return d;
        return {
            ...d,
            syncIntegracao: {
                uiStatus: sync.uiStatus,
                syncStatus: sync.syncStatus,
                syncAction: sync.syncAction,
                lastError: sync.lastError,
                errorCode: sync.errorCode,
                errorSeverity: sync.errorSeverity,
                errorSeverityLabel: sync.errorSeverityLabel,
                lastSyncAt: sync.lastSyncAt,
                lastSuccessAt: sync.lastSuccessAt,
                retryCount: sync.retryCount,
                provider: sync.provider,
                externalId: sync.externalId,
            },
        };
    });

    const totalPages = Math.max(1, Math.ceil(count / pageSize));

    return {
        data: dataComSync,
        meta: {
            page,
            pageSize,
            total: count,
            totalPages,
            hasMore: page < totalPages,
            filtro,
            ordenacao,
            busca: busca || null,
        },
    };
}

export async function obterReservaAdminDetalhe(
    idReserva: number,
    idUsuario: number,
    dataSelecionada?: string
) {
    const escopo = await resolverEscopoProdutor(idUsuario);

    const eventoWhere: WhereOptions = {
        tipo: 'Pousada',
        ...(escopo.admGeral ? {} : { idProdutor: { [Op.in]: escopo.idsProdutor } }),
    };

    const reserva = (await ReservaHospedagem.findOne({
        where: { id: idReserva },
        include: [
            {
                model: Usuario,
                as: 'Usuario',
                attributes: [
                    'id',
                    'nomeCompleto',
                    'telefone',
                    'email',
                    'cpf',
                ],
                required: false,
            },
            {
                model: Usuario,
                as: 'UsuarioCriacao',
                attributes: ['id', 'nomeCompleto'],
                required: false,
            },
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'nome', 'imagem', 'endereco', 'idProdutor'],
                where: eventoWhere,
                required: true,
            },
            {
                model: Transacao,
                as: 'Transacao',
                required: false,
            },
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                required: false,
                include: [
                    {
                        model: EventoSuite,
                        as: 'EventoSuite',
                        attributes: ['id', 'nome', 'descricao'],
                        required: false,
                    },
                    {
                        model: ReservaHospede,
                        as: 'ReservaHospede',
                        attributes: ['id', 'nome', 'tipo', 'dataNascimento'],
                        required: false,
                        // Ordem de cadastro (mesma da etapa de hóspedes).
                        separate: true,
                        order: [['id', 'ASC']],
                    },
                ],
            },
        ],
    })) as ReservaComIncludes | null;

    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    const suites = (reserva.ReservaSuite ?? []).map((suite) => {
        const hospedes = (
            (suite as SuiteComEvento & {
                ReservaHospede?: Array<{
                    id: number;
                    nome: string;
                    tipo: string;
                    dataNascimento?: Date | string | null;
                }>;
            }).ReservaHospede ?? []
        ).map((h) => ({
            id: h.id,
            nome: h.nome,
            tipo: h.tipo,
            dataNascimento: h.dataNascimento
                ? String(h.dataNascimento)
                : null,
        }));

        return {
            idReservaSuite: suite.id,
            idEventoSuite: suite.idEventoSuite,
            nome: suite.EventoSuite?.nome ?? `Suíte ${suite.idEventoSuite}`,
            adultos: suite.adultos,
            criancas: suite.criancas,
            preco: toNumber(suite.preco),
            taxaServico: toNumber(suite.taxaServico),
            valorTotal: toNumber(suite.valorTotal),
            valorOriginal:
                suite.valorOriginal != null
                    ? toNumber(suite.valorOriginal)
                    : null,
            descontoTipo: suite.descontoTipo ?? null,
            descontoValor:
                suite.descontoValor != null
                    ? toNumber(suite.descontoValor)
                    : null,
            valorFinal:
                suite.valorFinal != null ? toNumber(suite.valorFinal) : null,
            status: suite.status,
            hospedes,
        };
    });

    const pagamentosRows = await PagamentoHospedagem.findAll({
        where: { idReservaHospedagem: reserva.id },
        order: [['dataPagamento', 'ASC']],
        include: [
            {
                model: Usuario,
                as: 'Usuario',
                attributes: ['nomeCompleto'],
                required: false,
            },
        ],
    });

    const pagamentos = pagamentosRows.map((p) => {
        const row = p as PagamentoHospedagem & {
            Usuario?: { nomeCompleto?: string | null };
        };
        return {
            id: row.id,
            valor: toNumber(row.valor),
            dataPagamento: row.dataPagamento,
            formaPagamento: row.formaPagamento,
            formaPagamentoLabel: labelFormaPagamentoRecepcao(row.formaPagamento),
            comprovante: row.comprovante ?? null,
            observacao: row.observacao ?? null,
            idUsuario: row.idUsuario,
            usuario: row.Usuario?.nomeCompleto ?? null,
        };
    });

    const movimentacoes = await ReservaSuiteMovimentacao.findAll({
        where: { idReservaHospedagem: reserva.id },
        order: [['dataHora', 'ASC']],
        include: [
            {
                model: Usuario,
                as: 'Usuario',
                attributes: ['nomeCompleto'],
                required: false,
            },
            {
                model: EventoSuite,
                as: 'SuiteOrigem',
                attributes: ['id', 'nome'],
                required: false,
            },
            {
                model: EventoSuite,
                as: 'SuiteDestino',
                attributes: ['id', 'nome'],
                required: false,
            },
        ],
    });

    const movimentacoesSuite = movimentacoes.map((mov) => {
        const row = mov as ReservaSuiteMovimentacao & {
            Usuario?: { nomeCompleto?: string | null };
            SuiteOrigem?: { id: number; nome?: string } | null;
            SuiteDestino?: { id: number; nome?: string } | null;
        };
        return {
            id: row.id,
            dataHora: row.dataHora,
            motivo: row.motivo ?? null,
            tipo: row.tipo,
            suiteOrigem: {
                id: row.idEventoSuiteOrigem,
                nome:
                    row.SuiteOrigem?.nome ??
                    `Suíte ${row.idEventoSuiteOrigem}`,
            },
            suiteDestino: {
                id: row.idEventoSuiteDestino,
                nome:
                    row.SuiteDestino?.nome ??
                    `Suíte ${row.idEventoSuiteDestino}`,
            },
            usuario: row.Usuario?.nomeCompleto ?? null,
            idUsuario: row.idUsuario,
        };
    });

    type TimelineItem = {
        id: number | string;
        data: Date;
        titulo: string;
        descricao: string;
        usuario?: string | null;
        tipo: string;
        detalhe?: string | null;
        valor?: number | null;
        formaPagamento?: string | null;
        suiteOrigem?: string | null;
        suiteDestino?: string | null;
        motivo?: string | null;
        checkinAnterior?: string | null;
        checkoutAnterior?: string | null;
        checkinNovo?: string | null;
        checkoutNovo?: string | null;
    };

    const timeline: TimelineItem[] = [];

    const dataCriacao =
        (reserva as ReservaComIncludes).createdAt ??
        reserva.dataConfirmacao ??
        null;
    if (dataCriacao) {
        timeline.push({
            id: 'criacao',
            data: new Date(dataCriacao),
            titulo: 'Reserva criada',
            descricao: 'Reserva criada',
            usuario:
                (reserva as ReservaComIncludes).UsuarioCriacao?.nomeCompleto ??
                reserva.Usuario?.nomeCompleto ??
                null,
            tipo: 'criacao',
        });
    }

    if (reserva.linkPagamentoEnviadoEm) {
        timeline.push({
            id: 'link-enviado',
            data: new Date(reserva.linkPagamentoEnviadoEm),
            titulo: 'Link enviado',
            descricao: 'Link de pagamento enviado ao cliente',
            usuario: null,
            tipo: 'link',
        });
    }

    if (reserva.idTransacao) {
        const historicos = await HistoricoTransacao.findAll({
            where: { idTransacao: reserva.idTransacao },
            order: [['data', 'ASC']],
            include: [
                {
                    model: Usuario,
                    as: 'Usuario',
                    attributes: ['nomeCompleto'],
                    required: false,
                },
            ],
        });

        for (const h of historicos) {
            const row = h as HistoricoTransacao & {
                Usuario?: { nomeCompleto?: string | null };
            };
            const desc = String(row.descricao || '').trim();
            const descLower = desc.toLowerCase();
            let tipo = 'alteracao';
            let titulo = desc || 'Alteração';
            if (descLower.includes('check-in') || descLower.includes('checkin')) {
                tipo = 'checkin';
                titulo = 'Check-in realizado';
            } else if (
                descLower.includes('check-out') ||
                descLower.includes('checkout')
            ) {
                tipo = 'checkout';
                titulo = 'Check-out realizado';
            } else if (descLower.includes('cancel')) {
                tipo = 'cancelamento';
                titulo = 'Cancelamento';
            } else if (
                descLower.includes('pagamento') ||
                descLower.includes('pix') ||
                descLower.includes('dinheiro')
            ) {
                // Pagamentos estruturados vêm de PagamentoHospedagem.
                if (pagamentos.length > 0) continue;
                tipo = 'pagamento';
                titulo = 'Pagamento';
            } else if (descLower.includes('link')) {
                if (reserva.linkPagamentoEnviadoEm) continue;
                tipo = 'link';
                titulo = 'Link enviado';
            } else if (
                descLower.includes('suíte alterada') ||
                descLower.includes('suite alterada')
            ) {
                // Trocas vão pela tabela de movimentação — evita duplicar.
                continue;
            } else if (
                descLower.includes('reserva criada') ||
                descLower.includes('reserva confirmada')
            ) {
                // Criação já entra pelo createdAt.
                continue;
            }

            timeline.push({
                id: `ht-${row.id}`,
                data: row.data,
                titulo,
                descricao: desc,
                usuario: row.Usuario?.nomeCompleto ?? null,
                tipo,
            });
        }
    }

    let pagSeq = 0;
    for (const p of pagamentos) {
        pagSeq += 1;
        timeline.push({
            id: `pag-${p.id}`,
            data: new Date(p.dataPagamento),
            titulo:
                pagSeq === 1
                    ? 'Pagamento recebido'
                    : 'Pagamento complementar',
            descricao: `${p.formaPagamentoLabel || p.formaPagamento}`,
            usuario: p.usuario,
            tipo: 'pagamento',
            valor: p.valor,
            formaPagamento: p.formaPagamentoLabel || p.formaPagamento,
        });
    }

    const dataHoraCheckinReal =
        (reserva as ReservaHospedagem & { dataHoraCheckinReal?: Date | null })
            .dataHoraCheckinReal ?? null;
    if (
        dataHoraCheckinReal &&
        !timeline.some((t) => t.tipo === 'checkin')
    ) {
        timeline.push({
            id: 'checkin-real',
            data: new Date(dataHoraCheckinReal),
            titulo: 'Check-in realizado',
            descricao: 'Check-in realizado',
            usuario: null,
            tipo: 'checkin',
        });
    }

    const dataHoraCheckoutRealizado =
        (reserva as ReservaHospedagem & {
            dataHoraCheckoutRealizado?: Date | null;
        }).dataHoraCheckoutRealizado ?? null;
    if (
        dataHoraCheckoutRealizado &&
        !timeline.some((t) => t.tipo === 'checkout')
    ) {
        timeline.push({
            id: 'checkout-real',
            data: new Date(dataHoraCheckoutRealizado),
            titulo: 'Check-out realizado',
            descricao: 'Check-out realizado',
            usuario: null,
            tipo: 'checkout',
        });
    }

    if (
        reserva.status === StatusReservaHospedagem.Cancelada &&
        !timeline.some((t) => t.tipo === 'cancelamento')
    ) {
        timeline.push({
            id: 'cancelamento',
            data: dataHoraCheckoutRealizado
                ? new Date(dataHoraCheckoutRealizado)
                : new Date(dataCriacao || Date.now()),
            titulo: 'Cancelamento',
            descricao: 'Reserva cancelada',
            usuario: null,
            tipo: 'cancelamento',
        });
    }

    for (const mov of movimentacoesSuite) {
        timeline.push({
            id: `mov-${mov.id}`,
            data: new Date(mov.dataHora),
            titulo: 'Troca de suíte',
            descricao: `${mov.suiteOrigem.nome} → ${mov.suiteDestino.nome}`,
            usuario: mov.usuario,
            tipo: 'troca_suite',
            detalhe: `${mov.suiteOrigem.nome} → ${mov.suiteDestino.nome}`,
            suiteOrigem: mov.suiteOrigem.nome,
            suiteDestino: mov.suiteDestino.nome,
            motivo: mov.motivo,
        });
    }

    const movimentacoesPeriodoRows = await ReservaPeriodoMovimentacao.findAll({
        where: { idReservaHospedagem: reserva.id },
        order: [['dataHora', 'ASC']],
        include: [
            {
                model: Usuario,
                as: 'Usuario',
                attributes: ['nomeCompleto'],
                required: false,
            },
        ],
    });

    const movimentacoesPeriodo = movimentacoesPeriodoRows.map((mov) => {
        const row = mov as ReservaPeriodoMovimentacao & {
            Usuario?: { nomeCompleto?: string | null };
        };
        return {
            id: row.id,
            dataHora: row.dataHora,
            motivo: row.motivo ?? null,
            tipo: row.tipo,
            checkinAnterior: row.checkinAnterior,
            checkoutAnterior: row.checkoutAnterior,
            checkinNovo: row.checkinNovo,
            checkoutNovo: row.checkoutNovo,
            usuario: row.Usuario?.nomeCompleto ?? null,
            idUsuario: row.idUsuario,
        };
    });

    for (const mov of movimentacoesPeriodo) {
        timeline.push({
            id: `periodo-${mov.id}`,
            data: new Date(mov.dataHora),
            titulo: 'Período alterado',
            descricao: 'Período da reserva alterado',
            usuario: mov.usuario,
            tipo: 'alteracao_periodo',
            motivo: mov.motivo,
            checkinAnterior:
                mov.checkinAnterior instanceof Date
                    ? mov.checkinAnterior.toISOString()
                    : String(mov.checkinAnterior),
            checkoutAnterior:
                mov.checkoutAnterior instanceof Date
                    ? mov.checkoutAnterior.toISOString()
                    : String(mov.checkoutAnterior),
            checkinNovo:
                mov.checkinNovo instanceof Date
                    ? mov.checkinNovo.toISOString()
                    : String(mov.checkinNovo),
            checkoutNovo:
                mov.checkoutNovo instanceof Date
                    ? mov.checkoutNovo.toISOString()
                    : String(mov.checkoutNovo),
        });
    }

    timeline.sort(
        (a, b) => new Date(a.data).getTime() - new Date(b.data).getTime()
    );

    const transacao = reserva.Transacao
        ? {
              id: reserva.Transacao.id,
              status: reserva.Transacao.status,
              preco: toNumber(reserva.Transacao.preco),
              taxaServico: toNumber(reserva.Transacao.taxaServico),
              valorTotal: toNumber(reserva.Transacao.valorTotal),
              valorRecebido: toNumber(reserva.Transacao.valorRecebido ?? 0),
              tipoPagamento: reserva.Transacao.tipoPagamento ?? null,
              gatewayPagamento: reserva.Transacao.gatewayPagamento ?? null,
              dataPagamento: reserva.Transacao.dataPagamento ?? null,
              dataTransacao: reserva.Transacao.dataTransacao,
          }
        : null;

    const status = statusExibicaoReserva(reserva.status, reserva.checkout);

    const financeiro = resolverFinanceiroReserva({
        ...(reserva as ReservaHospedagem),
        Pagamentos: pagamentos.map((p) => ({ valor: p.valor })),
    } as ReservaHospedagem & {
        valorPago?: number;
        saldoPendente?: number | null;
        Pagamentos?: Array<{ valor?: number }>;
    });
    const valorPago = financeiro.valorPago;
    const saldoPendente = financeiro.saldoPendente;
    const valorTotalNum = toNumber(reserva.valorTotal);
    let situacaoFinanceira: 'Quitada' | 'Parcial' | 'Pendente' = 'Pendente';
    if (saldoPendente <= 0.009) {
        situacaoFinanceira = 'Quitada';
    } else if (valorPago > 0.009) {
        situacaoFinanceira = 'Parcial';
    }

    const origemReserva = resolverOrigemReserva(
        reserva as ReservaHospedagem & {
            origemReserva?: OrigemReservaHospedagem | string | null;
            idUsuarioCriacao?: number | null;
            formaPagamentoRecepcao?: string | null;
            comprovantePagamento?: string | null;
            observacaoPagamento?: string | null;
            valorPago?: number;
        },
        pagamentos.length > 0 || valorPago > 0
    );

    const idExterno =
        (reserva as ReservaHospedagem).idExterno ?? null;
    const codigoExterno =
        (reserva as ReservaHospedagem).codigoExterno ?? null;
    const canalVenda =
        (reserva as ReservaHospedagem).canalVenda ?? null;

    const deveCarregarOrigemIntegracao =
        String(origemReserva).toUpperCase() === 'HOSPEDIN' ||
        Boolean(idExterno) ||
        Boolean(canalVenda);
    const origemIntegracao = deveCarregarOrigemIntegracao
        ? await carregarOrigemIntegracao(reserva.id)
        : null;

    const idEventoSuiteOperacao = suites[0]?.idEventoSuite ?? null;
    const dataOp =
        dataSelecionada && /^\d{4}-\d{2}-\d{2}$/.test(dataSelecionada)
            ? dataSelecionada
            : formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
    const disponibilidadeBase = idEventoSuiteOperacao
        ? await montarDisponibilidadeOperacionalReserva(
              idEventoSuiteOperacao,
              dataOp
          )
        : null;

    // Ações do modal seguem a reserva em foco (reservaId), não só o badge da suíte.
    const hojeOp = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
    const acoesFoco = calcularAcoesOperacionaisDaReserva({
        reserva: {
            status: reserva.status as StatusReservaDisponibilidade,
            checkin: reserva.checkin,
            checkout: reserva.checkout,
            saldoPendente,
            dataHoraCheckinReal,
            dataHoraCheckoutRealizado,
        },
        dataSelecionada: dataOp,
        hoje: hojeOp,
    });
    const disponibilidade = disponibilidadeBase
        ? {
              ...disponibilidadeBase,
              podeCheckin: acoesFoco.podeCheckin,
              podeCheckout: acoesFoco.podeCheckout,
              botaoPrincipal: acoesFoco.podeCheckin
                  ? ('checkin' as const)
                  : acoesFoco.podeCheckout
                    ? ('checkout' as const)
                    : disponibilidadeBase.botaoPrincipal,
          }
        : null;

    return {
        id: reserva.id,
        idReservaHospedagem: reserva.id,
        numeroReserva: reserva.id,
        status,
        statusOriginal: reserva.status,
        checkin: reserva.checkin,
        checkout: reserva.checkout,
        noites: reserva.noites,
        preco: toNumber(reserva.preco),
        taxaServico: toNumber(reserva.taxaServico),
        valorTotal: valorTotalNum,
        valorPago,
        saldoPendente,
        situacaoFinanceira,
        formaPagamentoRecepcao:
            (reserva as ReservaHospedagem & {
                formaPagamentoRecepcao?: string | null;
            }).formaPagamentoRecepcao ?? null,
        observacaoPagamento:
            (reserva as ReservaHospedagem & {
                observacaoPagamento?: string | null;
            }).observacaoPagamento ?? null,
        comprovantePagamento:
            (reserva as ReservaHospedagem & {
                comprovantePagamento?: string | null;
            }).comprovantePagamento ?? null,
        origemReserva,
        idExterno,
        codigoExterno,
        canalVenda,
        origemIntegracao,
        syncIntegracao: await (async () => {
            const { getSyncStateByInternalId } = await import(
                '../integrations/core/SyncMonitorService'
            );
            return getSyncStateByInternalId(reserva.id);
        })(),
        idUsuarioCriacao:
            (reserva as ReservaHospedagem & {
                idUsuarioCriacao?: number | null;
            }).idUsuarioCriacao ?? null,
        nomeUsuarioCriacao:
            (reserva as ReservaComIncludes).UsuarioCriacao?.nomeCompleto ?? null,
        dataCriacao,
        dataConfirmacao: reserva.dataConfirmacao ?? null,
        dataHoraCheckinReal,
        idUsuarioCheckin:
            (reserva as ReservaHospedagem & {
                idUsuarioCheckin?: number | null;
            }).idUsuarioCheckin ?? null,
        dataHoraCheckoutRealizado,
        idUsuarioCheckout:
            (reserva as ReservaHospedagem & {
                idUsuarioCheckout?: number | null;
            }).idUsuarioCheckout ?? null,
        usuarioCheckout:
            (reserva as ReservaHospedagem & {
                idUsuarioCheckout?: number | null;
            }).idUsuarioCheckout ?? null,
        observacoes:
            (reserva as ReservaHospedagem & {
                observacoes?: string | null;
            }).observacoes ?? null,
        idTransacao: reserva.idTransacao ?? null,
        tokenPagamento: reserva.tokenPagamento ?? null,
        linkPagamento: reserva.tokenPagamento
            ? montarUrlPublicaReserva(reserva.tokenPagamento)
            : null,
        linkPagamentoEnviadoEm: reserva.linkPagamentoEnviadoEm ?? null,
        expiraEm: reserva.expiraEm ?? null,
        responsavel: reserva.Usuario?.nomeCompleto ?? '—',
        nomeResponsavel: reserva.Usuario?.nomeCompleto ?? '—',
        telefone: reserva.Usuario?.telefone ?? null,
        email: reserva.Usuario?.email ?? null,
        evento: reserva.Evento
            ? {
                  id: reserva.Evento.id,
                  nome: reserva.Evento.nome,
              }
            : null,
        suites,
        pagamentos,
        movimentacoesSuite,
        movimentacoesPeriodo,
        pagamento: transacao,
        transacao,
        timeline,
        /** Parte 7: estado operacional via SuiteDisponibilidadeService. */
        disponibilidade,
    };
}

export type StatusOperacionalSuite =
    | 'Livre'
    | 'Hospedada'
    | 'Ocupada'
    | 'CheckInHoje'
    | 'CheckOutHoje'
    | 'AguardandoPagamento'
    | 'Manutencao'
    | 'Bloqueada';

export type FiltroSuitesOperacional =
    | 'todas'
    | 'livres'
    | 'ocupadas'
    | 'hospedadas'
    | 'checkin_hoje'
    | 'checkout_hoje'
    | 'aguardando_pagamento'
    | 'manutencao'
    | 'bloqueadas'
    | '';

type ReservaSuiteComHospedagem = ReservaSuite & {
    ReservaHospedagem?: ReservaHospedagem & {
        Usuario?: UsuarioResumo | null;
        UsuarioCriacao?: UsuarioResumo | null;
    };
};

type RefDiaCuiaba = {
    dataReferencia: string;
    inicio: Date;
    fim: Date;
    ehHoje: boolean;
};

type EventoAgendaSuite = {
    tipo: 'reserva' | 'checkin' | 'checkout';
    idReservaHospedagem: number;
    idEventoSuite: number;
    suiteNome: string;
    inicio: string;
    fim: string;
    status: string;
    responsavel: string | null;
    dataHoraCheckinReal?: string | null;
    dataHoraCheckoutRealizado?: string | null;
};

function formatDataCuiaba(d: Date): string {
    const local = toZonedTime(d, TZ);
    const y = local.getFullYear();
    const mo = String(local.getMonth() + 1).padStart(2, '0');
    const day = String(local.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
}

function resolverDataReferencia(data?: string): RefDiaCuiaba {
    const hojeStr = formatDataCuiaba(new Date());
    const dataReferencia =
        data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : hojeStr;
    const [y, mo, d] = dataReferencia.split('-').map(Number);
    const refLocal = new Date(y, mo - 1, d);
    const inicioLocal = startOfDay(refLocal);
    const fimLocal = endOfDay(refLocal);
    return {
        dataReferencia,
        inicio: fromZonedTime(inicioLocal, TZ),
        fim: fromZonedTime(fimLocal, TZ),
        ehHoje: dataReferencia === hojeStr,
    };
}

function resolverMesReferencia(mes: string | undefined, dataReferencia: string): string {
    if (mes && /^\d{4}-\d{2}$/.test(mes)) {
        return mes;
    }
    return dataReferencia.slice(0, 7);
}

function boundsMesCuiaba(mesStr: string): {
    inicio: Date;
    fim: Date;
    diasNoMes: number;
} {
    const [y, mo] = mesStr.split('-').map(Number);
    const primeiroLocal = new Date(y, mo - 1, 1);
    const ultimoDia = new Date(y, mo, 0).getDate();
    const ultimoLocal = new Date(y, mo - 1, ultimoDia);
    return {
        inicio: fromZonedTime(startOfDay(primeiroLocal), TZ),
        fim: fromZonedTime(endOfDay(ultimoLocal), TZ),
        diasNoMes: ultimoDia,
    };
}

function montarEventoAgenda(
    item: ReservaSuiteComHospedagem,
    suiteNome: string,
    tipo: EventoAgendaSuite['tipo']
): EventoAgendaSuite {
    const rh = item.ReservaHospedagem!;
    const dataHoraCheckinReal =
        (rh as ReservaHospedagem & { dataHoraCheckinReal?: Date | null })
            ?.dataHoraCheckinReal ?? null;
    const dataHoraCheckoutRealizado =
        (rh as ReservaHospedagem & { dataHoraCheckoutRealizado?: Date | null })
            ?.dataHoraCheckoutRealizado ?? null;
    return {
        tipo,
        idReservaHospedagem: rh.id,
        idEventoSuite: item.idEventoSuite,
        suiteNome,
        inicio: new Date(rh.checkin).toISOString(),
        // Barra termina no check-out real quando já foi feito
        fim: new Date(
            dataHoraCheckoutRealizado ?? rh.checkout
        ).toISOString(),
        status: rh.status,
        responsavel: rh.Usuario?.nomeCompleto ?? null,
        dataHoraCheckinReal: dataHoraCheckinReal
            ? new Date(dataHoraCheckinReal).toISOString()
            : null,
        dataHoraCheckoutRealizado: dataHoraCheckoutRealizado
            ? new Date(dataHoraCheckoutRealizado).toISOString()
            : null,
    };
}

function montarCalendarioMes(
    mesStr: string,
    reservasMes: ReservaSuiteComHospedagem[],
    nomesSuites: Map<number, string>,
    idsSuites: number[]
) {
    const { diasNoMes } = boundsMesCuiaba(mesStr);
    const hojeStr = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');

    const porSuite = new Map<number, ReservaSuiteComHospedagem[]>();
    for (const item of reservasMes) {
        if (!item.ReservaHospedagem) continue;
        const lista = porSuite.get(item.idEventoSuite) ?? [];
        lista.push(item);
        porSuite.set(item.idEventoSuite, lista);
    }

    const dias: Array<{
        data: string;
        indicadores: {
            checkin: number;
            checkout: number;
            ocupada: number;
            livre: number;
            bloqueada: number;
            manutencao: number;
        };
        eventosAgenda: EventoAgendaSuite[];
        /** Parte 5: estado por suíte via SuiteDisponibilidadeService (Agenda / slots). */
        disponibilidadePorSuite: Array<{
            idEventoSuite: number;
            badge: string;
            podeReservar: boolean;
            disponivelAposCheckout: boolean;
            agendaOcupada: boolean;
        }>;
    }> = [];

    for (let dia = 1; dia <= diasNoMes; dia += 1) {
        const dataStr = `${mesStr}-${String(dia).padStart(2, '0')}`;

        let checkin = 0;
        let checkout = 0;
        let ocupada = 0;
        let livre = 0;
        const eventosAgenda: EventoAgendaSuite[] = [];
        const disponibilidadePorSuite: Array<{
            idEventoSuite: number;
            badge: string;
            podeReservar: boolean;
            disponivelAposCheckout: boolean;
            agendaOcupada: boolean;
        }> = [];

        for (const idSuite of idsSuites) {
            const reservasSuite = porSuite.get(idSuite) ?? [];
            const disp = calcularDisponibilidadeSuite({
                idEventoSuite: idSuite,
                dataSelecionada: dataStr,
                hoje: hojeStr,
                reservas: reservasParaDisponibilidade(reservasSuite),
            });

            disponibilidadePorSuite.push({
                idEventoSuite: idSuite,
                badge: disp.badge,
                podeReservar: disp.podeReservar,
                disponivelAposCheckout: disp.disponivelAposCheckout,
                agendaOcupada: disp.agendaOcupada,
            });

            switch (disp.badge) {
                case 'CHECKIN_HOJE':
                    checkin += 1;
                    break;
                case 'CHECKOUT_HOJE':
                    checkout += 1;
                    break;
                case 'HOSPEDADA':
                case 'RESERVADA':
                case 'AGUARDANDO_PAGAMENTO':
                    ocupada += 1;
                    break;
                case 'LIVRE':
                default:
                    livre += 1;
                    break;
            }

            const suiteNome = nomesSuites.get(idSuite) ?? '';
            for (const item of reservasSuite) {
                const input = reservasParaDisponibilidade([item])[0];
                if (!input) continue;
                const classif = classificarReservaNoDia(input, dataStr);
                if (!classif.agendaOcupada) continue;

                let tipo: EventoAgendaSuite['tipo'] = 'reserva';
                if (classif.badge === 'CHECKIN_HOJE') tipo = 'checkin';
                else if (classif.badge === 'CHECKOUT_HOJE') tipo = 'checkout';

                eventosAgenda.push(montarEventoAgenda(item, suiteNome, tipo));
            }
        }

        dias.push({
            data: dataStr,
            indicadores: {
                checkin,
                checkout,
                ocupada,
                livre,
                bloqueada: 0,
                manutencao: 0,
            },
            eventosAgenda,
            disponibilidadePorSuite,
        });
    }

    return {
        versao: 1 as const,
        modo: 'mes' as const,
        modoAgendaFuturo: 'timeline' as const,
        mes: mesStr,
        dias,
    };
}

function metaAgendaSuites() {
    return {
        versao: 1 as const,
        suporte: ['dia', 'mes', 'timeline'] as const,
        timezone: TZ,
    };
}

function montarMetaSuitesOperacionais(params: {
    filtro: FiltroSuitesOperacional;
    total: number;
    ref: RefDiaCuiaba;
    mesStr: string;
    reservasMes: ReservaSuiteComHospedagem[];
    nomesSuites: Map<number, string>;
    idsSuites: number[];
    mensagem?: string;
}) {
    return {
        filtro: params.filtro,
        total: params.total,
        dataReferencia: params.ref.dataReferencia,
        mes: params.mesStr,
        ...(params.mensagem ? { mensagem: params.mensagem } : {}),
        calendario: montarCalendarioMes(
            params.mesStr,
            params.reservasMes,
            params.nomesSuites,
            params.idsSuites
        ),
        agenda: metaAgendaSuites(),
    };
}

function badgeParaStatusOperacional(
    badge: BadgeSuiteDisponibilidade
): StatusOperacionalSuite {
    switch (badge) {
        case 'LIVRE':
            return 'Livre';
        case 'CHECKIN_HOJE':
            return 'CheckInHoje';
        case 'CHECKOUT_HOJE':
            return 'CheckOutHoje';
        case 'HOSPEDADA':
            return 'Hospedada';
        case 'RESERVADA':
            return 'Ocupada';
        case 'AGUARDANDO_PAGAMENTO':
            return 'AguardandoPagamento';
        default:
            return 'Livre';
    }
}

function reservasParaDisponibilidade(
    itens: ReservaSuiteComHospedagem[]
): ReservaDisponibilidadeInput[] {
    const out: ReservaDisponibilidadeInput[] = [];
    for (const item of itens) {
        const rh = item.ReservaHospedagem;
        if (!rh) continue;
        const financeiro = resolverFinanceiroReserva(
            rh as ReservaHospedagem & {
                valorPago?: number;
                saldoPendente?: number | null;
                Pagamentos?: Array<{ valor?: number }>;
            }
        );
        out.push({
            id: rh.id,
            status: rh.status as StatusReservaDisponibilidade,
            checkin: rh.checkin,
            checkout: rh.checkout,
            dataHoraCheckinReal:
                (rh as ReservaHospedagem & { dataHoraCheckinReal?: Date | null })
                    .dataHoraCheckinReal ?? null,
            dataHoraCheckoutRealizado:
                (rh as ReservaHospedagem & {
                    dataHoraCheckoutRealizado?: Date | null;
                }).dataHoraCheckoutRealizado ?? null,
            saldoPendente: financeiro.saldoPendente,
            responsavelNome: rh.Usuario?.nomeCompleto ?? null,
            origemReserva:
                (rh as ReservaHospedagem & {
                    origemReserva?: string | null;
                }).origemReserva ?? null,
            idUsuarioCriacao:
                (rh as ReservaHospedagem & {
                    idUsuarioCriacao?: number | null;
                }).idUsuarioCriacao ?? null,
            nomeUsuarioCriacao:
                (rh as ReservaHospedagem & {
                    UsuarioCriacao?: { nomeCompleto?: string | null };
                }).UsuarioCriacao?.nomeCompleto ?? null,
        });
    }
    return out;
}

/**
 * Parte 7: disponibilidade da suíte no dia para o sheet Check-in/Check-out.
 */
async function montarDisponibilidadeOperacionalReserva(
    idEventoSuite: number,
    dataSelecionada: string
) {
    const ocupantes = (await ReservaSuite.findAll({
        where: {
            idEventoSuite,
            status: {
                [Op.in]: [
                    StatusReservaSuite.Confirmada,
                    StatusReservaSuite.Hospedada,
                    StatusReservaSuite.AguardandoPagamento,
                ],
            },
        },
        include: [
            {
                model: ReservaHospedagem,
                as: 'ReservaHospedagem',
                required: true,
            },
        ],
    })) as ReservaSuiteComHospedagem[];

    const hojeStr = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
    const disp = calcularDisponibilidadeSuite({
        idEventoSuite,
        dataSelecionada,
        hoje: hojeStr,
        reservas: reservasParaDisponibilidade(ocupantes),
    });

    const entrada = disp.reservaEntradaNaData;
    const proximaReservaResumo = entrada
        ? {
              id: entrada.id,
              responsavel: entrada.responsavelNome ?? null,
              checkin:
                  entrada.checkin instanceof Date
                      ? entrada.checkin.toISOString()
                      : String(entrada.checkin),
              origemReserva: entrada.origemReserva ?? null,
              idUsuarioCriacao: entrada.idUsuarioCriacao ?? null,
              nomeUsuarioCriacao: entrada.nomeUsuarioCriacao ?? null,
          }
        : null;

    return {
        dataSelecionada,
        idEventoSuite,
        badge: disp.badge,
        badgeLabel: disp.badgeLabel,
        mensagem: disp.mensagem,
        mensagemSecundaria: disp.mensagemSecundaria,
        podeCheckin: disp.podeCheckin,
        podeCheckout: disp.podeCheckout,
        botaoPrincipal: disp.botaoPrincipal,
        podeReservar: disp.podeReservar,
        disponivelAposCheckout: disp.disponivelAposCheckout,
        agendaOcupada: disp.agendaOcupada,
        livre: disp.livre,
        checkinHoje: disp.checkinHoje,
        checkoutHoje: disp.checkoutHoje,
        hospedada: disp.hospedada,
        proximaReservaResumo,
    };
}

/**
 * Card Suítes (Parte 3): disponibilidade exclusivamente via SuiteDisponibilidadeService.
 */
function mapearCardSuiteOperacional(
    suite: EventoSuite & { Evento?: { id: number; nome: string } | null },
    reservasSuite: ReservaSuiteComHospedagem[],
    ref: RefDiaCuiaba
) {
    const hojeStr = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
    const disp = calcularDisponibilidadeSuite({
        idEventoSuite: suite.id,
        dataSelecionada: ref.dataReferencia,
        hoje: hojeStr,
        reservas: reservasParaDisponibilidade(reservasSuite),
    });

    const reservaAtualId = disp.reservaAtual?.id ?? null;
    const reservaSuite =
        reservasSuite.find((r) => r.ReservaHospedagem?.id === reservaAtualId) ??
        null;
    const rh = reservaSuite?.ReservaHospedagem ?? null;

    const financeiro = rh
        ? resolverFinanceiroReserva(
              rh as ReservaHospedagem & {
                  valorPago?: number;
                  saldoPendente?: number | null;
                  Pagamentos?: Array<{ valor?: number }>;
              }
          )
        : { valorPago: 0, saldoPendente: 0 };

    const origemReserva = rh
        ? resolverOrigemReserva(
              rh as ReservaHospedagem & {
                  origemReserva?: OrigemReservaHospedagem | string | null;
                  idUsuarioCriacao?: number | null;
                  formaPagamentoRecepcao?: string | null;
                  comprovantePagamento?: string | null;
                  observacaoPagamento?: string | null;
                  valorPago?: number;
              },
              financeiro.valorPago > 0
          )
        : null;

    const dataHoraCheckinReal =
        (rh as ReservaHospedagem & { dataHoraCheckinReal?: Date | null })
            ?.dataHoraCheckinReal ?? null;

    const statusOperacional = badgeParaStatusOperacional(disp.badge);

    const entrada = disp.reservaEntradaNaData;
    let proximaReservaResumo: {
        id: number;
        responsavel: string | null;
        checkin: string;
        checkout?: string | null;
        status?: string | null;
        origemReserva?: string | null;
        idUsuarioCriacao?: number | null;
        nomeUsuarioCriacao?: string | null;
        podeCheckin?: boolean;
        botao?: 'checkin' | 'ver_detalhes';
    } | null = null;

    if (entrada) {
        const acoesEntrada = calcularAcoesOperacionaisDaReserva({
            reserva: entrada,
            dataSelecionada: ref.dataReferencia,
            hoje: hojeStr,
        });
        proximaReservaResumo = {
            id: entrada.id,
            responsavel: entrada.responsavelNome ?? null,
            checkin:
                entrada.checkin instanceof Date
                    ? entrada.checkin.toISOString()
                    : String(entrada.checkin),
            checkout:
                entrada.checkout instanceof Date
                    ? entrada.checkout.toISOString()
                    : String(entrada.checkout),
            status: entrada.status ?? null,
            origemReserva: entrada.origemReserva ?? null,
            idUsuarioCriacao: entrada.idUsuarioCriacao ?? null,
            nomeUsuarioCriacao: entrada.nomeUsuarioCriacao ?? null,
            podeCheckin: acoesEntrada.podeCheckin,
            botao: acoesEntrada.podeCheckin ? 'checkin' : 'ver_detalhes',
        };
    }

    return {
        id: suite.id,
        idEventoSuite: suite.id,
        nome: suite.nome,
        descricao: suite.descricao ?? null,
        idEvento: suite.idEvento,
        eventoNome: suite.Evento?.nome ?? null,
        status: statusOperacional,
        /** Badge oficial da matriz (fonte: SuiteDisponibilidadeService). */
        badge: disp.badge,
        badgeLabel: disp.badgeLabel,
        botaoPrincipal: disp.botaoPrincipal,
        responsavel: rh?.Usuario?.nomeCompleto ?? null,
        telefone: rh?.Usuario?.telefone ?? null,
        checkin: rh?.checkin ?? null,
        checkout: rh?.checkout ?? null,
        dataHoraCheckinReal,
        adultos: reservaSuite ? Number(reservaSuite.adultos || 0) : 0,
        criancas: reservaSuite ? Number(reservaSuite.criancas || 0) : 0,
        valorHospedagem: rh ? toNumber(rh.valorTotal) : null,
        valorPago: rh ? financeiro.valorPago : null,
        saldoPendente: rh ? financeiro.saldoPendente : null,
        formaPagamentoRecepcao: rh
            ? (rh as ReservaHospedagem & {
                  formaPagamentoRecepcao?: string | null;
              }).formaPagamentoRecepcao ?? null
            : null,
        origemReserva,
        idUsuarioCriacao: rh
            ? (rh as ReservaHospedagem & {
                  idUsuarioCriacao?: number | null;
              }).idUsuarioCriacao ?? null
            : null,
        nomeUsuarioCriacao: rh
            ? (rh as ReservaHospedagem & {
                  UsuarioCriacao?: { nomeCompleto?: string | null };
              }).UsuarioCriacao?.nomeCompleto ?? null
            : null,
        dataCriacao: rh
            ? (rh as ReservaHospedagem & { createdAt?: Date }).createdAt ??
              rh.dataConfirmacao ??
              null
            : null,
        valorSuite: reservaSuite ? toNumber(reservaSuite.valorTotal) : null,
        idReservaHospedagem: rh?.id ?? null,
        numeroReserva: rh?.id ?? null,
        statusReserva: rh ? statusExibicaoReserva(rh.status, rh.checkout) : null,
        ocupadaAgora: disp.agendaOcupada,
        hospedada: disp.hospedada,
        checkinHoje: disp.checkinHoje,
        checkoutHoje: disp.checkoutHoje,
        aguardandoPagamento: disp.badge === 'AGUARDANDO_PAGAMENTO',
        disponivelHojeAposCheckout: disp.disponivelAposCheckout,
        bloqueadaPorCheckinNaData: disp.possuiCheckinNaData,
        mensagemDisponibilidade: disp.mensagem,
        mensagemDisponibilidadeSecundaria: disp.mensagemSecundaria,
        proximaReservaResumo,
        /** Dois blocos no card quando CO + nova entrada no mesmo dia. */
        modoDuplaReserva: Boolean(
            disp.badge === 'CHECKOUT_HOJE' &&
                rh?.id &&
                proximaReservaResumo?.id &&
                proximaReservaResumo.id !== rh.id
        ),
        acoesDisponiveis: {
            verReserva: Boolean(rh?.id) || disp.botaoPrincipal === 'ver_reserva',
            reservar: disp.podeReservar,
            checkin: disp.podeCheckin,
            checkout: disp.podeCheckout,
            limpeza: false,
            manutencao: false,
            bloqueio: false,
            calendario: false,
        },
    };
}

function formatHoraCuiaba(d: Date | string): string {
    return formatInTimeZone(
        d instanceof Date ? d : new Date(d),
        TZ,
        'HH:mm'
    );
}

function formatDataCurtaCuiaba(d: Date | string): string {
    return formatInTimeZone(
        d instanceof Date ? d : new Date(d),
        TZ,
        'dd/MM'
    );
}

async function carregarReservasSuitesOperacionais(
    idsSuites: number[],
    mesInicio: Date,
    mesFim: Date
): Promise<ReservaSuiteComHospedagem[]> {
    return (await ReservaSuite.findAll({
        where: {
            idEventoSuite: { [Op.in]: idsSuites },
            status: {
                [Op.in]: [
                    StatusReservaHospedagem.Confirmada,
                    StatusReservaHospedagem.Hospedada,
                    StatusReservaHospedagem.AguardandoPagamento,
                ],
            },
        },
        include: [
            {
                model: ReservaHospedagem,
                as: 'ReservaHospedagem',
                required: true,
                where: {
                    status: {
                        [Op.in]: [
                            StatusReservaHospedagem.Confirmada,
                            StatusReservaHospedagem.Hospedada,
                            StatusReservaHospedagem.AguardandoPagamento,
                        ],
                    },
                    checkout: { [Op.gt]: mesInicio },
                    checkin: { [Op.lte]: mesFim },
                },
                include: [
                    {
                        model: Usuario,
                        as: 'Usuario',
                        attributes: ['nomeCompleto', 'telefone', 'email'],
                        required: false,
                    },
                    {
                        model: Usuario,
                        as: 'UsuarioCriacao',
                        attributes: ['id', 'nomeCompleto'],
                        required: false,
                    },
                    {
                        model: PagamentoHospedagem,
                        as: 'Pagamentos',
                        attributes: ['id', 'valor', 'formaPagamento'],
                        required: false,
                    },
                ],
            },
        ],
    })) as ReservaSuiteComHospedagem[];
}

function filtrarCardsOperacionais<
    T extends {
        status: StatusOperacionalSuite;
        ocupadaAgora?: boolean;
        hospedada?: boolean;
        checkinHoje?: boolean;
        checkoutHoje?: boolean;
        disponivelHojeAposCheckout?: boolean;
        aguardandoPagamento?: boolean;
    }
>(cards: T[], filtro: FiltroSuitesOperacional): T[] {
    switch (filtro) {
        case 'livres':
            // Disponível para nova reserva: Livre ou checkout hoje sem
            // check-in na mesma data (mesma regra da etapa Selecionar Suíte).
            return cards.filter(
                (c) =>
                    c.status === 'Livre' ||
                    c.disponivelHojeAposCheckout === true
            );
        case 'ocupadas':
        case 'hospedadas':
            return cards.filter(
                (c) =>
                    c.status === 'Hospedada' ||
                    c.hospedada === true ||
                    (c.ocupadaAgora === true && c.status !== 'CheckInHoje')
            );
        case 'checkin_hoje':
            return cards.filter(
                (c) =>
                    c.status === 'CheckInHoje' || c.checkinHoje === true
            );
        case 'checkout_hoje':
            return cards.filter(
                (c) =>
                    c.status === 'CheckOutHoje' || c.checkoutHoje === true
            );
        case 'aguardando_pagamento':
            return cards.filter(
                (c) =>
                    c.aguardandoPagamento === true ||
                    c.status === 'AguardandoPagamento'
            );
        case 'todas':
        case '':
        default:
            return cards;
    }
}

/**
 * Prioridade operacional para a grade (atenção primeiro),
 * depois nome alfabético dentro do grupo.
 *
 * 1 Hospedada → 2 Check-in → 3 Check-out → 4 Aguardando pag. →
 * 5 Reservada → 6 Livre → 7 Manutenção → 8 Bloqueada
 */
function prioridadeCardOperacional(card: {
    badge?: string | null;
    status?: string | null;
}): number {
    const badge = String(card.badge || '').toUpperCase();
    const status = String(card.status || '');

    if (badge === 'HOSPEDADA' || status === 'Hospedada') return 1;
    if (badge === 'CHECKIN_HOJE' || status === 'CheckInHoje') return 2;
    if (badge === 'CHECKOUT_HOJE' || status === 'CheckOutHoje') return 3;
    if (
        badge === 'AGUARDANDO_PAGAMENTO' ||
        status === 'AguardandoPagamento'
    ) {
        return 4;
    }
    if (badge === 'RESERVADA' || status === 'Ocupada') return 5;
    if (status === 'Manutencao') return 7;
    if (status === 'Bloqueada') return 8;
    return 6; // Livre / demais
}

function ordenarCardsOperacionais<
    T extends { nome?: string | null; badge?: string | null; status?: string | null }
>(cards: T[]): T[] {
    return [...cards].sort((a, b) => {
        const pa = prioridadeCardOperacional(a);
        const pb = prioridadeCardOperacional(b);
        if (pa !== pb) return pa - pb;
        return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', {
            sensitivity: 'base',
            numeric: true,
        });
    });
}

export async function listarSituacaoSuites(params: {
    idUsuario: number;
    filtro?: string;
    data?: string;
    mes?: string;
}) {
    const filtro = (params.filtro || 'todas') as FiltroSuitesOperacional;
    const ref = resolverDataReferencia(params.data);
    const mesStr = resolverMesReferencia(params.mes, ref.dataReferencia);
    const { inicio: mesInicio, fim: mesFim } = boundsMesCuiaba(mesStr);
    const escopo = await resolverEscopoProdutor(params.idUsuario);

    const eventoWhere: WhereOptions = {
        tipo: 'Pousada',
        ...(escopo.admGeral
            ? {}
            : { idProdutor: { [Op.in]: escopo.idsProdutor } }),
    };

    const suites = (await EventoSuite.findAll({
        where: {
            status: { [Op.in]: ['Ativo', 'PDV'] },
        },
        include: [
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'nome', 'idProdutor'],
                where: eventoWhere,
                required: true,
            },
        ],
        order: [['nome', 'ASC']],
    })) as Array<
        EventoSuite & { Evento?: { id: number; nome: string } | null }
    >;

    const nomesSuites = new Map(suites.map((s) => [s.id, s.nome]));
    const idsSuites = suites.map((s) => s.id);

    const reservasMes =
        idsSuites.length > 0
            ? await carregarReservasSuitesOperacionais(
                  idsSuites,
                  mesInicio,
                  mesFim
              )
            : [];

    if (filtro === 'manutencao' || filtro === 'bloqueadas') {
        return {
            data: [],
            meta: montarMetaSuitesOperacionais({
                filtro,
                total: 0,
                ref,
                mesStr,
                reservasMes,
                nomesSuites,
                idsSuites,
                mensagem:
                    filtro === 'manutencao'
                        ? 'Status Manutenção será habilitado em etapa futura.'
                        : 'Status Bloqueada será habilitado em etapa futura.',
            }),
        };
    }

    if (idsSuites.length === 0) {
        return {
            data: [],
            meta: montarMetaSuitesOperacionais({
                filtro,
                total: 0,
                ref,
                mesStr,
                reservasMes,
                nomesSuites,
                idsSuites,
            }),
        };
    }

    // Todas as reservas do mês por suíte → SuiteDisponibilidadeService (cards).
    // Calendário mensal continua com reservasMes + montarCalendarioMes (legado).
    const porSuite = new Map<number, ReservaSuiteComHospedagem[]>();
    for (const item of reservasMes) {
        if (!item.ReservaHospedagem) continue;
        const lista = porSuite.get(item.idEventoSuite) ?? [];
        lista.push(item);
        porSuite.set(item.idEventoSuite, lista);
    }

    let cards = suites.map((suite) => {
        const reservasSuite = porSuite.get(suite.id) ?? [];
        return mapearCardSuiteOperacional(suite, reservasSuite, ref);
    });

    cards = filtrarCardsOperacionais(cards, filtro);
    cards = ordenarCardsOperacionais(cards);

    return {
        data: cards,
        meta: montarMetaSuitesOperacionais({
            filtro,
            total: cards.length,
            ref,
            mesStr,
            reservasMes,
            nomesSuites,
            idsSuites,
        }),
    };
}

export async function obterSituacaoSuite(
    idEventoSuite: number,
    idUsuario: number,
    data?: string
) {
    const { data: cards } = await listarSituacaoSuites({
        idUsuario,
        filtro: 'todas',
        data,
    });
    const suite = cards.find((s) => s.idEventoSuite === idEventoSuite);
    if (!suite) {
        throw new CustomError('Suíte não encontrada.', 404, '');
    }
    return suite;
}

/** Check-in operacional: Confirmada → Hospedada. */
export async function realizarCheckinAdmin(
    idReservaHospedagem: number,
    idUsuario: number
) {
    const escopo = await resolverEscopoProdutor(idUsuario);

    const reserva = (await ReservaHospedagem.findByPk(idReservaHospedagem, {
        include: [
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'idProdutor'],
                required: true,
            },
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                required: false,
            },
        ],
    })) as
        | (ReservaHospedagem & {
              Evento?: { id: number; idProdutor?: number } | null;
              ReservaSuite?: ReservaSuite[];
          })
        | null;

    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    if (
        !escopo.admGeral &&
        !escopo.idsProdutor.includes(Number(reserva.Evento?.idProdutor))
    ) {
        throw new CustomError(
            'Sem permissão para esta reserva.',
            403,
            ''
        );
    }

    if (reserva.status === StatusReservaHospedagem.Hospedada) {
        throw new CustomError('Check-in já realizado para esta reserva.', 400, '');
    }

    if (reserva.status !== StatusReservaHospedagem.Confirmada) {
        throw new CustomError(
            'Somente reservas confirmadas podem realizar check-in.',
            400,
            ''
        );
    }

    const financeiroCheckin = resolverFinanceiroReserva(
        reserva as ReservaHospedagem & {
            valorPago?: number;
            saldoPendente?: number | null;
            Pagamentos?: Array<{ valor?: number }>;
        }
    );
    if (financeiroCheckin.saldoPendente > 0.009) {
        throw new CustomError(
            'Não é possível realizar o check-in enquanto houver saldo pendente. Receba o pagamento antes de prosseguir.',
            400,
            ''
        );
    }

    // data atual (Cuiabá) >= dia de check-in
    const hojeLocal = toZonedTime(new Date(), TZ);
    const checkinLocal = toZonedTime(new Date(reserva.checkin), TZ);
    const inicioHoje = startOfDay(hojeLocal);
    const inicioCheckin = startOfDay(checkinLocal);
    if (inicioHoje.getTime() < inicioCheckin.getTime()) {
        const dd = String(checkinLocal.getDate()).padStart(2, '0');
        const mm = String(checkinLocal.getMonth() + 1).padStart(2, '0');
        throw new CustomError(
            `Check-in disponível em ${dd}/${mm}.`,
            400,
            ''
        );
    }

    const agora = new Date();

    await connection.transaction(async (t: Transaction) => {
        await reserva.update(
            {
                status: StatusReservaHospedagem.Hospedada,
                dataHoraCheckinReal: agora,
                idUsuarioCheckin: idUsuario,
            },
            { transaction: t }
        );

        const suites = reserva.ReservaSuite ?? [];
        for (const suite of suites) {
            await suite.update(
                { status: StatusReservaSuite.Hospedada },
                { transaction: t }
            );
        }

        if (reserva.idTransacao) {
            await HistoricoTransacao.create(
                {
                    idTransacao: reserva.idTransacao,
                    idUsuario,
                    data: agora,
                    descricao: 'Check-in realizado',
                },
                { transaction: t }
            );
        }
    });

    return obterReservaAdminDetalhe(idReservaHospedagem, idUsuario);
}

/** Check-out operacional: Hospedada → CheckOutRealizado. */
export async function realizarCheckoutAdmin(
    idReservaHospedagem: number,
    idUsuario: number
) {
    const escopo = await resolverEscopoProdutor(idUsuario);

    const reserva = (await ReservaHospedagem.findByPk(idReservaHospedagem, {
        include: [
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'idProdutor'],
                required: true,
            },
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                required: false,
            },
        ],
    })) as
        | (ReservaHospedagem & {
              Evento?: { id: number; idProdutor?: number } | null;
              ReservaSuite?: ReservaSuite[];
          })
        | null;

    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    if (
        !escopo.admGeral &&
        !escopo.idsProdutor.includes(Number(reserva.Evento?.idProdutor))
    ) {
        throw new CustomError(
            'Sem permissão para esta reserva.',
            403,
            ''
        );
    }

    if (reserva.status === StatusReservaHospedagem.CheckOutRealizado) {
        throw new CustomError(
            'Check-out já realizado para esta reserva.',
            400,
            ''
        );
    }

    if (reserva.status !== StatusReservaHospedagem.Hospedada) {
        throw new CustomError(
            'Somente reservas hospedadas podem realizar check-out.',
            400,
            ''
        );
    }

    const agora = new Date();

    await connection.transaction(async (t: Transaction) => {
        await reserva.update(
            {
                status: StatusReservaHospedagem.CheckOutRealizado,
                dataHoraCheckoutRealizado: agora,
                idUsuarioCheckout: idUsuario,
            },
            { transaction: t }
        );

        const suites = reserva.ReservaSuite ?? [];
        for (const suite of suites) {
            await suite.update(
                { status: StatusReservaSuite.CheckOutRealizado },
                { transaction: t }
            );
        }

        if (reserva.idTransacao) {
            await HistoricoTransacao.create(
                {
                    idTransacao: reserva.idTransacao,
                    idUsuario,
                    data: agora,
                    descricao: 'Check-out realizado.',
                },
                { transaction: t }
            );
        }
    });

    return obterReservaAdminDetalhe(idReservaHospedagem, idUsuario);
}

/** Reserva manual da recepção: Confirmada + notificação (reusa checkoutHospedagem). */
export async function criarReservaRecepcaoAdmin(params: {
    idUsuarioOperador: number;
    idEvento: number;
    idUsuarioCliente: number;
    checkin: Date;
    checkout: Date;
    suites: import('./reservaSuiteService').SuiteCheckoutItem[];
    observacoes?: string | null;
    pagamento?: import('../utils/hospedagemPagamentoRecepcao').PagamentoRecepcaoInput | null;
    /** Quando true: AguardandoPagamento + link para o cliente (não altera Salvar Reserva). */
    enviarParaCliente?: boolean;
}) {
    const escopo = await resolverEscopoProdutor(params.idUsuarioOperador);

    const evento = await Evento.findByPk(params.idEvento, {
        attributes: ['id', 'idProdutor', 'tipo'],
    });
    if (!evento || (evento as Evento & { tipo?: string }).tipo !== 'Pousada') {
        throw new CustomError('Evento de pousada não encontrado.', 404, '');
    }
    if (
        !escopo.admGeral &&
        !escopo.idsProdutor.includes(Number(evento.idProdutor))
    ) {
        throw new CustomError(
            'Sem permissão para criar reserva neste evento.',
            403,
            ''
        );
    }

    const { checkoutHospedagem } = await import('./reservaSuiteService');

    const resultado = await checkoutHospedagem({
        idEvento: params.idEvento,
        idUsuario: params.idUsuarioCliente,
        checkin: params.checkin,
        checkout: params.checkout,
        suites: params.suites,
        origem: 'recepcao',
        enviarParaCliente: !!params.enviarParaCliente,
        observacoes: params.observacoes,
        idUsuarioOperador: params.idUsuarioOperador,
        pagamento: params.enviarParaCliente ? null : params.pagamento ?? null,
    });

    return obterReservaAdminDetalhe(
        resultado.hospedagem.id,
        params.idUsuarioOperador
    );
}

/** Reenvia o link de pagamento (WhatsApp/e-mail) — só AguardandoPagamento com token. */
export async function reenviarLinkPagamentoReservaAdmin(
    idReserva: number,
    idUsuarioOperador: number
) {
    await obterReservaAdminDetalhe(idReserva, idUsuarioOperador);

    const reserva = await ReservaHospedagem.findByPk(idReserva);
    if (!reserva) {
        throw new CustomError('Reserva não encontrada.', 404, '');
    }
    if (reserva.status !== StatusReservaHospedagem.AguardandoPagamento) {
        throw new CustomError(
            'Somente reservas aguardando pagamento podem reenviar o link.',
            400,
            ''
        );
    }
    if (!reserva.tokenPagamento) {
        const { gerarTokenPagamentoReserva } = await import(
            './reservaSuiteService'
        );
        reserva.tokenPagamento = gerarTokenPagamentoReserva();
        await reserva.save();
    }

    const { linkPagamento } = await notificarLinkPagamentoHospedagem(reserva.id);
    const detalhe = await obterReservaAdminDetalhe(idReserva, idUsuarioOperador);
    return { ...detalhe, linkPagamento };
}

function statusPermiteTrocaSuite(status: string): boolean {
    return (
        status === StatusReservaHospedagem.Confirmada ||
        status === StatusReservaHospedagem.Hospedada
    );
}

async function carregarOcupantesSuiteParaPeriodo(
    idEventoSuite: number
): Promise<ReservaDisponibilidadeInput[]> {
    const ocupantes = (await ReservaSuite.findAll({
        where: {
            idEventoSuite,
            status: {
                [Op.in]: [
                    StatusReservaSuite.Confirmada,
                    StatusReservaSuite.Hospedada,
                    StatusReservaSuite.AguardandoPagamento,
                ],
            },
        },
        include: [
            {
                model: ReservaHospedagem,
                as: 'ReservaHospedagem',
                required: true,
            },
        ],
    })) as ReservaSuiteComHospedagem[];
    return reservasParaDisponibilidade(ocupantes);
}

/** Lista suítes disponíveis para troca (mesmas regras da Nova Reserva + capacidade). */
export async function listarSuitesDisponiveisParaTroca(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    idReservaSuite?: number;
}) {
    const detalhe = await obterReservaAdminDetalhe(
        params.idReservaHospedagem,
        params.idUsuario
    );

    if (!statusPermiteTrocaSuite(String(detalhe.statusOriginal ?? detalhe.status))) {
        throw new CustomError(
            'Somente reservas Confirmada ou Hospedada podem trocar de suíte.',
            400,
            ''
        );
    }

    const suitesLinha = detalhe.suites ?? [];
    const linha =
        (params.idReservaSuite
            ? suitesLinha.find(
                  (s: { idReservaSuite: number }) =>
                      s.idReservaSuite === params.idReservaSuite
              )
            : suitesLinha[0]) ?? null;

    if (!linha) {
        throw new CustomError('Linha de suíte da reserva não encontrada.', 404, '');
    }

    const idEvento = detalhe.evento?.id;
    if (!idEvento) {
        throw new CustomError('Evento da reserva não encontrado.', 404, '');
    }

    const checkin = new Date(detalhe.checkin);
    const checkout = new Date(detalhe.checkout);
    const adultos = Number(linha.adultos || 0);
    const criancas = Number(linha.criancas || 0);
    const idSuiteAtual = Number(linha.idEventoSuite);

    const suites = await EventoSuite.findAll({
        where: {
            idEvento,
            status: 'Ativo',
            id: { [Op.ne]: idSuiteAtual },
        },
    });

    const disponiveis = [];
    for (const suite of suites) {
        const reservas = await carregarOcupantesSuiteParaPeriodo(suite.id);
        const disp = calcularDisponibilidadePeriodo({
            idEventoSuite: suite.id,
            checkin,
            checkout,
            reservas,
        });
        if (!disp.podeReservar) continue;

        try {
            calcularExtrasPousada(
                adultos,
                criancas,
                suite.qtdeMinimaPessoas,
                suite.qtdeMaximaPessoas
            );
        } catch {
            continue;
        }

        disponiveis.push({
            id: suite.id,
            idEventoSuite: suite.id,
            nome: suite.nome,
            descricao: suite.descricao ?? null,
            qtdeMinimaPessoas: suite.qtdeMinimaPessoas,
            qtdeMaximaPessoas: suite.qtdeMaximaPessoas,
            livre: true,
            podeReservar: true,
        });
    }

    return {
        idReservaHospedagem: params.idReservaHospedagem,
        idReservaSuite: linha.idReservaSuite,
        suiteAtual: {
            idEventoSuite: idSuiteAtual,
            nome: linha.nome,
        },
        checkin: detalhe.checkin,
        checkout: detalhe.checkout,
        responsavel: detalhe.responsavel,
        adultos,
        criancas,
        suites: disponiveis,
    };
}

/** Opera troca de suíte com histórico (ReservaSuiteMovimentacao). */
export async function trocarSuiteReservaAdmin(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    idReservaSuite: number;
    idEventoSuiteDestino: number;
    motivo?: string | null;
}) {
    const escopo = await resolverEscopoProdutor(params.idUsuario);

    const reserva = (await ReservaHospedagem.findByPk(params.idReservaHospedagem, {
        include: [
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'idProdutor'],
                required: true,
            },
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                required: false,
                include: [
                    {
                        model: EventoSuite,
                        as: 'EventoSuite',
                        attributes: ['id', 'nome'],
                        required: false,
                    },
                ],
            },
        ],
    })) as
        | (ReservaHospedagem & {
              Evento?: { id: number; idProdutor?: number } | null;
              ReservaSuite?: Array<
                  ReservaSuite & {
                      EventoSuite?: { id: number; nome?: string } | null;
                  }
              >;
          })
        | null;

    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    if (
        !escopo.admGeral &&
        !escopo.idsProdutor.includes(Number(reserva.Evento?.idProdutor))
    ) {
        throw new CustomError('Sem permissão para esta reserva.', 403, '');
    }

    if (!statusPermiteTrocaSuite(reserva.status)) {
        throw new CustomError(
            'Somente reservas Confirmada ou Hospedada podem trocar de suíte.',
            400,
            ''
        );
    }

    const linha =
        (reserva.ReservaSuite ?? []).find(
            (s) => s.id === params.idReservaSuite
        ) ?? null;
    if (!linha) {
        throw new CustomError('Linha de suíte da reserva não encontrada.', 404, '');
    }

    const idOrigem = Number(linha.idEventoSuite);
    const idDestino = Number(params.idEventoSuiteDestino);
    if (!(idDestino > 0)) {
        throw new CustomError('Suíte de destino inválida.', 400, '');
    }
    if (idDestino === idOrigem) {
        throw new CustomError('A suíte de destino é a mesma da atual.', 400, '');
    }

    const suiteDestino = await EventoSuite.findByPk(idDestino);
    if (!suiteDestino || suiteDestino.idEvento !== reserva.idEvento) {
        throw new CustomError(
            'Suíte de destino não pertence ao estabelecimento da reserva.',
            400,
            ''
        );
    }
    if (suiteDestino.status !== 'Ativo') {
        throw new CustomError('Suíte de destino não está disponível.', 400, '');
    }

    try {
        calcularExtrasPousada(
            Number(linha.adultos || 0),
            Number(linha.criancas || 0),
            suiteDestino.qtdeMinimaPessoas,
            suiteDestino.qtdeMaximaPessoas
        );
    } catch (e) {
        throw e;
    }

    const reservasDestino = await carregarOcupantesSuiteParaPeriodo(idDestino);
    const disp = calcularDisponibilidadePeriodo({
        idEventoSuite: idDestino,
        checkin: new Date(reserva.checkin),
        checkout: new Date(reserva.checkout),
        reservas: reservasDestino,
    });
    if (!disp.podeReservar) {
        throw new CustomError(
            `Suíte indisponível no período: ${suiteDestino.nome}.`,
            409,
            ''
        );
    }

    const motivo = params.motivo?.trim() || null;
    const agora = new Date();

    await connection.transaction(async (t: Transaction) => {
        await ReservaSuiteMovimentacao.create(
            {
                idReservaHospedagem: reserva.id,
                idReservaSuite: linha.id,
                idEventoSuiteOrigem: idOrigem,
                idEventoSuiteDestino: idDestino,
                idUsuario: params.idUsuario,
                dataHora: agora,
                motivo,
                tipo: TipoMovimentacaoSuite.TRANSFERENCIA,
            },
            { transaction: t }
        );

        await linha.update({ idEventoSuite: idDestino }, { transaction: t });
    });

    return obterReservaAdminDetalhe(reserva.id, params.idUsuario);
}

function statusPermiteAlterarPeriodo(status: string): boolean {
    return (
        status === StatusReservaHospedagem.Confirmada ||
        status === StatusReservaHospedagem.Hospedada
    );
}

/** Altera período da reserva com histórico (ReservaPeriodoMovimentacao). */
export async function alterarPeriodoReservaAdmin(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    checkin: Date;
    checkout: Date;
    motivo?: string | null;
}) {
    const escopo = await resolverEscopoProdutor(params.idUsuario);

    const reserva = (await ReservaHospedagem.findByPk(params.idReservaHospedagem, {
        include: [
            {
                model: Evento,
                as: 'Evento',
                attributes: ['id', 'idProdutor'],
                required: true,
            },
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                required: false,
                include: [
                    {
                        model: EventoSuite,
                        as: 'EventoSuite',
                        attributes: [
                            'id',
                            'nome',
                            'status',
                            'qtdeMinimaPessoas',
                            'qtdeMaximaPessoas',
                        ],
                        required: false,
                    },
                ],
            },
        ],
    })) as
        | (ReservaHospedagem & {
              Evento?: { id: number; idProdutor?: number } | null;
              ReservaSuite?: Array<
                  ReservaSuite & {
                      EventoSuite?: {
                          id: number;
                          nome?: string;
                          status?: string;
                          qtdeMinimaPessoas?: number;
                          qtdeMaximaPessoas?: number;
                      } | null;
                  }
              >;
          })
        | null;

    if (!reserva) {
        throw new CustomError('Reserva de hospedagem não encontrada.', 404, '');
    }

    if (
        !escopo.admGeral &&
        !escopo.idsProdutor.includes(Number(reserva.Evento?.idProdutor))
    ) {
        throw new CustomError('Sem permissão para esta reserva.', 403, '');
    }

    if (!statusPermiteAlterarPeriodo(reserva.status)) {
        throw new CustomError(
            'Somente reservas Confirmada ou Hospedada podem alterar o período.',
            400,
            ''
        );
    }

    const checkinNovo = params.checkin;
    const checkoutNovo = params.checkout;
    if (
        !(checkinNovo instanceof Date) ||
        Number.isNaN(checkinNovo.getTime()) ||
        !(checkoutNovo instanceof Date) ||
        Number.isNaN(checkoutNovo.getTime())
    ) {
        throw new CustomError('checkin e checkout inválidos.', 400, '');
    }
    if (checkoutNovo.getTime() <= checkinNovo.getTime()) {
        throw new CustomError(
            'O check-out deve ser posterior ao check-in.',
            400,
            ''
        );
    }

    const checkinAnterior = new Date(reserva.checkin);
    const checkoutAnterior = new Date(reserva.checkout);
    if (
        checkinAnterior.getTime() === checkinNovo.getTime() &&
        checkoutAnterior.getTime() === checkoutNovo.getTime()
    ) {
        throw new CustomError('O período informado é o mesmo da reserva.', 400, '');
    }

    let noites: number;
    try {
        noites = calcularNoitesHotelaria(checkinNovo, checkoutNovo);
    } catch (e) {
        throw e;
    }

    const linhas = reserva.ReservaSuite ?? [];
    if (!linhas.length) {
        throw new CustomError('Reserva sem suíte vinculada.', 400, '');
    }

    const hojeStr = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');
    const dataCiNovo = formatInTimeZone(checkinNovo, TZ, 'yyyy-MM-dd');
    const jaHospedada =
        reserva.status === StatusReservaHospedagem.Hospedada ||
        Boolean(
            (reserva as ReservaHospedagem & { dataHoraCheckinReal?: Date | null })
                .dataHoraCheckinReal
        );

    for (const linha of linhas) {
        const suite = linha.EventoSuite;
        if (!suite || suite.status !== 'Ativo') {
            throw new CustomError(
                `Suíte ${suite?.nome ?? linha.idEventoSuite} não está disponível.`,
                400,
                ''
            );
        }

        try {
            calcularExtrasPousada(
                Number(linha.adultos || 0),
                Number(linha.criancas || 0),
                suite.qtdeMinimaPessoas,
                suite.qtdeMaximaPessoas
            );
        } catch (e) {
            throw e;
        }

        const ocupantes = await carregarOcupantesSuiteParaPeriodo(suite.id);
        const ocupantesSemSelf = ocupantes.filter(
            (r) => Number(r.id) !== Number(reserva.id)
        );

        const disp = calcularDisponibilidadePeriodo({
            idEventoSuite: suite.id,
            checkin: checkinNovo,
            checkout: checkoutNovo,
            reservas: ocupantesSemSelf,
            hoje: hojeStr,
        });

        if (disp.conflitoPeriodo) {
            throw new CustomError(
                `Suíte indisponível no período: ${suite.nome}.`,
                409,
                ''
            );
        }

        // Mesma regra da Nova Reserva no dia do CI, quando o CI ainda é futuro/hoje.
        // Estadia já iniciada (CI no passado): valida só conflito (prorrogação/antecipação).
        if (dataCiNovo >= hojeStr || !jaHospedada) {
            if (!disp.disponibilidadeNoDiaCheckin.podeReservar) {
                throw new CustomError(
                    `Suíte indisponível no período: ${suite.nome}.`,
                    409,
                    ''
                );
            }
        }
    }

    const motivo = params.motivo?.trim() || null;
    const agora = new Date();

    await connection.transaction(async (t: Transaction) => {
        await ReservaPeriodoMovimentacao.create(
            {
                idReservaHospedagem: reserva.id,
                idUsuario: params.idUsuario,
                dataHora: agora,
                checkinAnterior,
                checkoutAnterior,
                checkinNovo,
                checkoutNovo,
                motivo,
                tipo: TipoMovimentacaoPeriodo.ALTERACAO,
            },
            { transaction: t }
        );

        await reserva.update(
            {
                checkin: checkinNovo,
                checkout: checkoutNovo,
                noites,
            },
            { transaction: t }
        );
    });

    return obterReservaAdminDetalhe(reserva.id, params.idUsuario);
}
