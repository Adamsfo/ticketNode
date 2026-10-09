import { Op, WhereOptions } from 'sequelize';
import { endOfDay, startOfDay } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { Evento } from '../models/Evento';
import { EventoSuite } from '../models/EventoSuite';
import {
    ReservaHospedagem,
    StatusReservaHospedagem,
} from '../models/ReservaHospedagem';
import { ReservaSuite, StatusReservaSuite } from '../models/ReservaSuite';
import { Usuario } from '../models/Usuario';
import { ProdutorAcesso } from '../models/Produtor';
import { CustomError } from '../utils/customError';
import { TZ_HOSPEDAGEM, reservaTemCheckinNaDataCivil } from '../utils/reservaSuiteUtils';
import { resolverRelacaoDiaReserva } from './suiteDisponibilidadeService';

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_RESERVA_INVALIDOS = new Set<string>([
    StatusReservaHospedagem.Cancelada,
    StatusReservaHospedagem.Expirada,
    StatusReservaSuite.Cancelada,
    StatusReservaSuite.Expirada,
]);

export type PrevisaoLimpezaSuiteItem = {
    idEventoSuite: number;
    nomeSuite: string | null;
    eventoNome: string | null;
    idReservaHospedagem: number;
    idReservaSuite: number;
    numeroReserva: number;
    hospede: string | null;
    checkin: string | null;
    checkout: string | null;
    statusReserva: string | null;
    prioridade: boolean;
};

export type LinhaPrevisaoLimpezaInput = {
    idReservaSuite: number;
    idEventoSuite: number;
    nomeSuite: string | null;
    eventoNome: string | null;
    idReservaHospedagem: number;
    hospede: string | null;
    checkin: Date | string;
    checkout: Date | string;
    statusReservaHospedagem: string;
    statusReservaSuite: string;
};

export function parseDataPrevisaoLimpeza(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!RE_DATA.test(raw)) {
        throw new CustomError(
            'Data inválida. Use o formato AAAA-MM-DD.',
            400,
            ''
        );
    }
    return raw;
}

export function boundsDiaCivilHospedagem(dataYmd: string): {
    inicio: Date;
    fim: Date;
} {
    const [y, m, day] = dataYmd.split('-').map(Number);
    const local = new Date(y, m - 1, day);
    return {
        inicio: fromZonedTime(startOfDay(local), TZ_HOSPEDAGEM),
        fim: fromZonedTime(endOfDay(local), TZ_HOSPEDAGEM),
    };
}

export function reservaValidaPrevisaoLimpeza(
    statusReservaHospedagem: string,
    statusReservaSuite: string
): boolean {
    if (STATUS_RESERVA_INVALIDOS.has(statusReservaHospedagem)) {
        return false;
    }
    if (STATUS_RESERVA_INVALIDOS.has(statusReservaSuite)) {
        return false;
    }
    return true;
}

export function linhaPrevisaoCheckoutNaData(
    linha: Pick<LinhaPrevisaoLimpezaInput, 'checkin' | 'checkout'>,
    dataSelecionada: string
): boolean {
    return (
        resolverRelacaoDiaReserva(
            { checkin: linha.checkin, checkout: linha.checkout },
            dataSelecionada
        ) === 'dia_checkout'
    );
}

function isoOrNull(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Monta a previsão do dia a partir de linhas de reserva (sem criar limpezas).
 * Uma entrada por suíte; prioridade quando há check-in válido na mesma data.
 */
export function montarPrevisaoLimpezaSuites(
    linhas: LinhaPrevisaoLimpezaInput[],
    dataSelecionada: string,
    suitesComCheckinNaData: ReadonlySet<number>
): PrevisaoLimpezaSuiteItem[] {
    const candidatos: PrevisaoLimpezaSuiteItem[] = [];

    for (const linha of linhas) {
        if (
            !reservaValidaPrevisaoLimpeza(
                linha.statusReservaHospedagem,
                linha.statusReservaSuite
            )
        ) {
            continue;
        }
        if (!linhaPrevisaoCheckoutNaData(linha, dataSelecionada)) {
            continue;
        }

        candidatos.push({
            idEventoSuite: linha.idEventoSuite,
            nomeSuite: linha.nomeSuite,
            eventoNome: linha.eventoNome,
            idReservaHospedagem: linha.idReservaHospedagem,
            idReservaSuite: linha.idReservaSuite,
            numeroReserva: linha.idReservaHospedagem,
            hospede: linha.hospede,
            checkin: isoOrNull(linha.checkin),
            checkout: isoOrNull(linha.checkout),
            statusReserva: linha.statusReservaHospedagem,
            prioridade: suitesComCheckinNaData.has(linha.idEventoSuite),
        });
    }

    const porSuite = new Map<number, PrevisaoLimpezaSuiteItem>();
    for (const item of candidatos) {
        const existente = porSuite.get(item.idEventoSuite);
        if (!existente) {
            porSuite.set(item.idEventoSuite, item);
            continue;
        }
        const preferirNovo =
            (item.prioridade && !existente.prioridade) ||
            (item.prioridade === existente.prioridade &&
                item.idReservaSuite > existente.idReservaSuite);
        if (preferirNovo) {
            porSuite.set(item.idEventoSuite, item);
        }
    }

    return [...porSuite.values()].sort((a, b) => {
        if (a.prioridade !== b.prioridade) {
            return a.prioridade ? -1 : 1;
        }
        const na = (a.nomeSuite ?? '').localeCompare(b.nomeSuite ?? '', 'pt-BR');
        if (na !== 0) return na;
        return a.idEventoSuite - b.idEventoSuite;
    });
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

function eventoWhereEscopo(escopo: {
    admGeral: boolean;
    idsProdutor: number[];
}): WhereOptions {
    return escopo.admGeral
        ? {}
        : { idProdutor: { [Op.in]: escopo.idsProdutor } };
}

type LinhaDb = ReservaSuite & {
    EventoSuite?: EventoSuite & {
        Evento?: { id: number; nome: string } | null;
    };
    ReservaHospedagem?: ReservaHospedagem & {
        Usuario?: { nomeCompleto?: string | null } | null;
    };
};

function mapearLinhaDb(row: LinhaDb): LinhaPrevisaoLimpezaInput | null {
    const rh = row.ReservaHospedagem;
    const suite = row.EventoSuite;
    if (!rh || !suite) return null;

    return {
        idReservaSuite: row.id,
        idEventoSuite: row.idEventoSuite,
        nomeSuite: suite.nome ?? null,
        eventoNome: suite.Evento?.nome ?? null,
        idReservaHospedagem: rh.id,
        hospede: rh.Usuario?.nomeCompleto ?? null,
        checkin: rh.checkin,
        checkout: rh.checkout,
        statusReservaHospedagem: String(rh.status),
        statusReservaSuite: String(row.status),
    };
}

const includeReservaPrevisao = (eventoWhere: WhereOptions) => [
    {
        model: EventoSuite,
        as: 'EventoSuite',
        required: true,
        attributes: ['id', 'nome', 'status'],
        where: { status: 'Ativo' },
        include: [
            {
                model: Evento,
                as: 'Evento',
                required: true,
                attributes: ['id', 'nome'],
                where: eventoWhere,
            },
        ],
    },
    {
        model: ReservaHospedagem,
        as: 'ReservaHospedagem',
        required: true,
        attributes: ['id', 'checkin', 'checkout', 'status'],
        include: [
            {
                model: Usuario,
                as: 'Usuario',
                attributes: ['id', 'nomeCompleto'],
                required: false,
            },
        ],
    },
];

function suitesComCheckinValidoNoDia(
    linhas: LinhaPrevisaoLimpezaInput[],
    dataSelecionada: string
): Set<number> {
    const ids = new Set<number>();
    for (const linha of linhas) {
        if (
            !reservaValidaPrevisaoLimpeza(
                linha.statusReservaHospedagem,
                linha.statusReservaSuite
            )
        ) {
            continue;
        }
        const checkin =
            linha.checkin instanceof Date
                ? linha.checkin
                : new Date(linha.checkin);
        if (reservaTemCheckinNaDataCivil(checkin, dataSelecionada)) {
            ids.add(linha.idEventoSuite);
        }
    }
    return ids;
}

export async function listarPrevisaoLimpezaSuitesAdmin(params: {
    idUsuario: number;
    data: string;
}) {
    const dataSelecionada = parseDataPrevisaoLimpeza(params.data);
    const escopo = await resolverEscopoProdutor(params.idUsuario);
    const eventoWhere = eventoWhereEscopo(escopo);
    const { inicio, fim } = boundsDiaCivilHospedagem(dataSelecionada);

    const statusValidosRh = {
        [Op.notIn]: [
            StatusReservaHospedagem.Cancelada,
            StatusReservaHospedagem.Expirada,
        ],
    };
    const statusValidosRs = {
        [Op.notIn]: [StatusReservaSuite.Cancelada, StatusReservaSuite.Expirada],
    };

    const [linhasCheckout, linhasCheckin] = await Promise.all([
        ReservaSuite.findAll({
            where: { status: statusValidosRs },
            include: includeReservaPrevisao(eventoWhere).map((inc) => {
                if (inc.as !== 'ReservaHospedagem') return inc;
                return {
                    ...inc,
                    where: {
                        status: statusValidosRh,
                        checkout: { [Op.between]: [inicio, fim] },
                    },
                };
            }),
        }) as Promise<LinhaDb[]>,
        ReservaSuite.findAll({
            where: { status: statusValidosRs },
            include: includeReservaPrevisao(eventoWhere).map((inc) => {
                if (inc.as !== 'ReservaHospedagem') return inc;
                return {
                    ...inc,
                    where: {
                        status: statusValidosRh,
                        checkin: { [Op.between]: [inicio, fim] },
                    },
                };
            }),
        }) as Promise<LinhaDb[]>,
    ]);

    const linhasCheckoutMapeadas = linhasCheckout
        .map(mapearLinhaDb)
        .filter((l): l is LinhaPrevisaoLimpezaInput => l != null);

    const linhasCheckinMapeadas = linhasCheckin
        .map(mapearLinhaDb)
        .filter((l): l is LinhaPrevisaoLimpezaInput => l != null);

    const suitesComCheckin = suitesComCheckinValidoNoDia(
        linhasCheckinMapeadas,
        dataSelecionada
    );

    const data = montarPrevisaoLimpezaSuites(
        linhasCheckoutMapeadas,
        dataSelecionada,
        suitesComCheckin
    );

    return {
        data,
        meta: {
            data: dataSelecionada,
            total: data.length,
        },
    };
}
