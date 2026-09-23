import { Op } from 'sequelize';
import { getHospedinConfig } from '../integrations/hospedin/constants/config';
import {
    ReservaHospedagem,
    StatusReservaHospedagem,
} from '../models/ReservaHospedagem';
import { ReservaSuite, StatusReservaSuite } from '../models/ReservaSuite';
import { logger } from '../utils/logger';
import {
    consultarVendaHospedagemPorId,
    type ConsultaVendaHospedagemResult,
} from '../api/hospedagemVendaJangoReadService';
import {
    avaliarStatusVendaCheckoutAutomatico,
    calcularLimiteCheckoutComMargem,
    idVendaJangoValido,
    mapearMotivoConsultaPdv,
    type AcaoCheckoutAutomaticoPdv,
} from './hospedagemCheckoutAutomaticoPolicy';

const log = logger.child('CheckoutAutomaticoHospedagem');

export type ResultadoItemCheckoutAutomatico = {
    idReservaHospedagem: number;
    idVendaJango: number;
    acao: AcaoCheckoutAutomaticoPdv;
    checkoutExecutado: boolean;
    erro?: string;
};

export type ResultadoCheckoutAutomaticoDiario = {
    candidatas: number;
    processadas: number;
    checkoutExecutados: number;
    ignoradas: number;
    falhas: number;
    itens: ResultadoItemCheckoutAutomatico[];
};

/**
 * Mesmo usuário técnico da integração Hospedin (`getHospedinConfig().syncUserId`).
 */
export async function resolverIdUsuarioCheckoutAutomatico(): Promise<number> {
    const syncUserId = getHospedinConfig().syncUserId;
    if (!syncUserId) {
        throw new Error(
            'Configure HOSPEDIN_SYNC_USER_ID (Usuario cliente técnico da integração).'
        );
    }
    return syncUserId;
}

export type ReservaSuiteCheckoutAutomatico = Pick<
    ReservaSuite,
    'id' | 'status' | 'dataHoraCheckoutRealizado' | 'idUsuarioCheckout'
>;

export async function listarSuitesReservaCheckoutAutomatico(
    idReservaHospedagem: number
): Promise<ReservaSuiteCheckoutAutomatico[]> {
    return ReservaSuite.findAll({
        where: { idReservaHospedagem },
        attributes: ['id', 'status', 'dataHoraCheckoutRealizado', 'idUsuarioCheckout'],
        order: [['id', 'ASC']],
    });
}

async function executarCheckoutAutomaticoNaReserva(params: {
    idReservaHospedagem: number;
    idUsuario: number;
    dataHoraCheckout: Date;
    listarSuites?: (
        idReserva: number
    ) => Promise<ReservaSuiteCheckoutAutomatico[]>;
    realizarCheckoutSuite?: (
        idReserva: number,
        idReservaSuite: number,
        idUsuario: number,
        dataHoraCheckout: Date
    ) => Promise<unknown>;
    realizarCheckoutAdmin?: (
        idReserva: number,
        idUsuario: number,
        dataHoraCheckout: Date
    ) => Promise<unknown>;
}): Promise<boolean> {
    const listar =
        params.listarSuites ?? listarSuitesReservaCheckoutAutomatico;
    const suites = await listar(params.idReservaHospedagem);

    const suitesHospedadas = suites.filter(
        (suite) => suite.status === StatusReservaSuite.Hospedada
    );

    if (suitesHospedadas.length === 0) {
        if (suites.length === 0) {
            const realizarCheckoutAdmin =
                params.realizarCheckoutAdmin ??
                (async (idReserva, idUsuario, dataHora) => {
                    const { realizarCheckoutAdmin: checkoutAdmin } =
                        await import('./hospedagemAdminService');
                    return checkoutAdmin(idReserva, idUsuario, dataHora);
                });
            await realizarCheckoutAdmin(
                params.idReservaHospedagem,
                params.idUsuario,
                params.dataHoraCheckout
            );
            return true;
        }
        return false;
    }

    const realizarCheckoutSuite =
        params.realizarCheckoutSuite ??
        (async (idReserva, idReservaSuite, idUsuario, dataHora) => {
            const { realizarCheckoutReservaSuiteAdmin } = await import(
                './hospedagemAdminService'
            );
            return realizarCheckoutReservaSuiteAdmin(
                idReserva,
                idReservaSuite,
                idUsuario,
                dataHora
            );
        });

    for (const suite of suitesHospedadas) {
        await realizarCheckoutSuite(
            params.idReservaHospedagem,
            suite.id,
            params.idUsuario,
            params.dataHoraCheckout
        );
    }

    return true;
}

export async function listarReservasCandidatasCheckoutAutomatico(
    agora: Date = new Date()
): Promise<ReservaHospedagem[]> {
    const limiteCheckout = calcularLimiteCheckoutComMargem(agora);

    return ReservaHospedagem.findAll({
        where: {
            status: StatusReservaHospedagem.Hospedada,
            checkout: { [Op.lte]: limiteCheckout },
            idVendaJango: { [Op.gt]: 0 },
        },
        attributes: ['id', 'checkout', 'idVendaJango', 'idTransacao', 'status'],
        order: [['checkout', 'ASC'], ['id', 'ASC']],
    });
}

async function processarReservaCheckoutAutomatico(params: {
    reserva: Pick<
        ReservaHospedagem,
        'id' | 'checkout' | 'idVendaJango' | 'idTransacao' | 'status'
    >;
    idUsuario: number;
    consultarVenda?: (
        idVenda: number
    ) => Promise<ConsultaVendaHospedagemResult>;
    listarSuites?: (
        idReserva: number
    ) => Promise<ReservaSuiteCheckoutAutomatico[]>;
    realizarCheckoutSuite?: (
        idReserva: number,
        idReservaSuite: number,
        idUsuario: number,
        dataHoraCheckout: Date
    ) => Promise<unknown>;
    realizarCheckoutAdmin?: (
        idReserva: number,
        idUsuario: number,
        dataHoraCheckout: Date
    ) => Promise<unknown>;
}): Promise<ResultadoItemCheckoutAutomatico> {
    const idReserva = Number(params.reserva.id);
    const idVendaJango = Number(params.reserva.idVendaJango);

    const base: ResultadoItemCheckoutAutomatico = {
        idReservaHospedagem: idReserva,
        idVendaJango,
        acao: 'IGNORAR_ERRO_PDV',
        checkoutExecutado: false,
    };

    if (!idVendaJangoValido(idVendaJango)) {
        return {
            ...base,
            acao: 'IGNORAR_VENDA_INEXISTENTE',
        };
    }

    const consultar =
        params.consultarVenda ?? consultarVendaHospedagemPorId;
    const consulta = await consultar(idVendaJango);

    if (!consulta.ok) {
        const acao = mapearMotivoConsultaPdv(consulta.motivo);
        log.warn('Consulta PDV sem checkout automático', {
            idReserva,
            idVendaJango,
            motivo: consulta.motivo,
            acao,
        });
        return { ...base, acao };
    }

    const avaliacao = avaliarStatusVendaCheckoutAutomatico(consulta.venda.status);
    if (!avaliacao.executarCheckout) {
        log.info('Checkout automático ignorado', {
            idReserva,
            idVendaJango,
            statusPdv: consulta.venda.status,
            acao: avaliacao.acao,
        });
        return {
            ...base,
            acao: avaliacao.acao,
        };
    }

    const dataHoraCheckout = new Date(params.reserva.checkout);
    if (Number.isNaN(dataHoraCheckout.getTime())) {
        log.warn('Checkout previsto inválido — ignorando reserva', {
            idReserva,
            idVendaJango,
        });
        return {
            ...base,
            acao: 'IGNORAR_STATUS_INESPERADO',
            erro: 'checkout inválido',
        };
    }

    try {
        const checkoutExecutado = await executarCheckoutAutomaticoNaReserva({
            idReservaHospedagem: idReserva,
            idUsuario: params.idUsuario,
            dataHoraCheckout,
            listarSuites: params.listarSuites,
            realizarCheckoutSuite: params.realizarCheckoutSuite,
            realizarCheckoutAdmin: params.realizarCheckoutAdmin,
        });

        if (!checkoutExecutado) {
            log.info('Checkout automático — nenhuma suíte pendente', {
                idReserva,
                idVendaJango,
            });
            return {
                ...base,
                acao: 'IGNORAR_STATUS_INESPERADO',
            };
        }

        log.info('Checkout automático realizado', {
            idReserva,
            idVendaJango,
            dataHoraCheckout: dataHoraCheckout.toISOString(),
        });

        return {
            ...base,
            acao: 'EXECUTAR_CHECKOUT',
            checkoutExecutado: true,
        };
    } catch (error) {
        const mensagem =
            error instanceof Error ? error.message : 'Erro desconhecido';
        log.error('Falha ao executar checkout automático', {
            idReserva,
            idVendaJango,
            erro: mensagem,
        });
        return {
            ...base,
            acao: 'EXECUTAR_CHECKOUT',
            erro: mensagem,
        };
    }
}

export type DependenciasCheckoutAutomatico = {
    consultarVenda?: (
        idVenda: number
    ) => Promise<ConsultaVendaHospedagemResult>;
    listarSuites?: (
        idReserva: number
    ) => Promise<ReservaSuiteCheckoutAutomatico[]>;
    realizarCheckoutSuite?: (
        idReserva: number,
        idReservaSuite: number,
        idUsuario: number,
        dataHoraCheckout: Date
    ) => Promise<unknown>;
    realizarCheckoutAdmin?: (
        idReserva: number,
        idUsuario: number,
        dataHoraCheckout: Date
    ) => Promise<unknown>;
    listarCandidatas?: (agora: Date) => Promise<ReservaHospedagem[]>;
    resolverUsuario?: () => Promise<number>;
};

export async function executarCheckoutAutomaticoDiario(
    agora: Date = new Date(),
    deps?: DependenciasCheckoutAutomatico
): Promise<ResultadoCheckoutAutomaticoDiario> {
    const idUsuario = deps?.resolverUsuario
        ? await deps.resolverUsuario()
        : await resolverIdUsuarioCheckoutAutomatico();
    const candidatas = deps?.listarCandidatas
        ? await deps.listarCandidatas(agora)
        : await listarReservasCandidatasCheckoutAutomatico(agora);

    const resultado: ResultadoCheckoutAutomaticoDiario = {
        candidatas: candidatas.length,
        processadas: 0,
        checkoutExecutados: 0,
        ignoradas: 0,
        falhas: 0,
        itens: [],
    };

    if (!candidatas.length) {
        log.info('Checkout automático — nenhuma candidata', {
            agora: agora.toISOString(),
        });
        return resultado;
    }

    log.info('Checkout automático — iniciando processamento', {
        candidatas: candidatas.length,
        idUsuario,
    });

    for (const reserva of candidatas) {
        resultado.processadas += 1;
        const item = await processarReservaCheckoutAutomatico({
            reserva,
            idUsuario,
            consultarVenda: deps?.consultarVenda,
            listarSuites: deps?.listarSuites,
            realizarCheckoutSuite: deps?.realizarCheckoutSuite,
            realizarCheckoutAdmin: deps?.realizarCheckoutAdmin,
        });
        resultado.itens.push(item);

        if (item.checkoutExecutado) {
            resultado.checkoutExecutados += 1;
        } else if (item.erro) {
            resultado.falhas += 1;
        } else {
            resultado.ignoradas += 1;
        }
    }

    log.info('Checkout automático — concluído', {
        candidatas: resultado.candidatas,
        checkoutExecutados: resultado.checkoutExecutados,
        ignoradas: resultado.ignoradas,
        falhas: resultado.falhas,
    });

    return resultado;
}
