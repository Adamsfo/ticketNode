import { formatInTimeZone } from 'date-fns-tz';
import { databaseReady } from '../database';
import { logger } from '../utils/logger';
import {
    HORA_CHECKOUT_AUTOMATICO,
    TIMEZONE_CHECKOUT_AUTOMATICO,
} from '../services/hospedagemCheckoutAutomaticoPolicy';
import { executarCheckoutAutomaticoDiario } from '../services/hospedagemCheckoutAutomaticoService';

const log = logger.child('CheckoutAutomaticoJob');
const INTERVALO_MS = 60 * 1000;

/** Controle apenas da execução agendada das 02:00 — independente do startup. */
let ultimaDataExecutadaAgendada: string | null = null;
let jobEmExecucao = false;
let relogioAgendadoTeste: (() => Date) | null = null;

function agoraAgendado(): Date {
    return relogioAgendadoTeste ? relogioAgendadoTeste() : new Date();
}

function dataHojeCuiaba(agora: Date = new Date()): string {
    return formatInTimeZone(agora, TIMEZONE_CHECKOUT_AUTOMATICO, 'yyyy-MM-dd');
}

/**
 * Janela 02:00–02:01 (America/Cuiaba) para tolerar desalinhamento do setInterval.
 * 01:59 → não; 02:00/02:01 → sim (se ainda não executou no dia).
 */
export function deveExecutarNestaJanela(agora: Date = new Date()): boolean {
    const hora = Number(
        formatInTimeZone(agora, TIMEZONE_CHECKOUT_AUTOMATICO, 'H')
    );
    const minuto = Number(
        formatInTimeZone(agora, TIMEZONE_CHECKOUT_AUTOMATICO, 'm')
    );

    if (hora !== HORA_CHECKOUT_AUTOMATICO) {
        return false;
    }

    return minuto >= 0 && minuto <= 1;
}

async function executarComLock(
    origem: 'startup' | 'agendado',
    agora: Date = new Date()
): Promise<boolean> {
    if (jobEmExecucao) {
        return false;
    }

    jobEmExecucao = true;
    try {
        log.info('Disparando checkout automático', {
            origem,
            data: dataHojeCuiaba(agora),
            timezone: TIMEZONE_CHECKOUT_AUTOMATICO,
        });
        await executarCheckoutAutomaticoDiario(agora);
        return true;
    } catch (error) {
        log.error('Erro no job de checkout automático', {
            origem,
            erro: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });
        return false;
    } finally {
        jobEmExecucao = false;
    }
}

/** Verificação imediata na inicialização do servidor — independente do agendamento. */
export async function executarCheckoutAutomaticoNaInicializacao(): Promise<void> {
    await databaseReady;
    await executarComLock('startup');
}

async function tickCheckoutAutomaticoAgendado(): Promise<void> {
    if (jobEmExecucao) {
        return;
    }

    const agora = agoraAgendado();
    if (!deveExecutarNestaJanela(agora)) {
        return;
    }

    const dataHoje = dataHojeCuiaba(agora);
    if (ultimaDataExecutadaAgendada === dataHoje) {
        return;
    }

    const executou = await executarComLock('agendado', agora);
    if (executou) {
        ultimaDataExecutadaAgendada = dataHoje;
    }
}

export function iniciarJobCheckoutAutomaticoHospedagem(): void {
    void executarCheckoutAutomaticoNaInicializacao();

    setInterval(() => {
        void tickCheckoutAutomaticoAgendado();
    }, INTERVALO_MS);

    log.info('Job de checkout automático de hospedagem registrado', {
        horario: `${String(HORA_CHECKOUT_AUTOMATICO).padStart(2, '0')}:00`,
        timezone: TIMEZONE_CHECKOUT_AUTOMATICO,
        intervaloMs: INTERVALO_MS,
        verificacaoStartup: true,
    });
}

/** Apenas para testes — reinicia estado in-memory do job. */
export function resetEstadoJobCheckoutAutomaticoHospedagem(): void {
    ultimaDataExecutadaAgendada = null;
    jobEmExecucao = false;
    relogioAgendadoTeste = null;
}

/** Apenas para testes — expõe lógica sem aguardar relógio real. */
export const checkoutAutomaticoJobTestHelpers = {
    deveExecutarNestaJanela,
    dataHojeCuiaba,
    tickCheckoutAutomaticoAgendado,
    executarCheckoutAutomaticoNaInicializacao,
    getUltimaDataExecutadaAgendada: () => ultimaDataExecutadaAgendada,
    setJobEmExecucao: (valor: boolean) => {
        jobEmExecucao = valor;
    },
    setRelogioAgendado: (fn: (() => Date) | null) => {
        relogioAgendadoTeste = fn;
    },
};
