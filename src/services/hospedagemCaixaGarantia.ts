import apiJango, { type CaixaResumoPdv } from '../api/apiJango';
import { logger } from '../utils/logger';
import {
    escolherCaixaAbertoPreferido,
    isCaixaPdvAberto,
    type CaixaPdvRegistro,
} from '../utils/caixaPdvAberto';

export type GarantiaCaixaHospedagemContexto = {
    idPagamentoHospedagem?: number;
    formaPagamento?: string;
};

export type GarantiaCaixaHospedagemDeps = {
    getCaixaAbertoDoDia: () => Promise<CaixaResumoPdv | null>;
    listCaixasAbertosDoDia: () => Promise<CaixaResumoPdv[]>;
    inseriCaixaItemAbertura: () => Promise<number>;
    aguardarMs?: (ms: number) => Promise<void>;
};

const defaultDeps: GarantiaCaixaHospedagemDeps = {
    getCaixaAbertoDoDia: () => apiJango().getCaixaAbertoDoDia(),
    listCaixasAbertosDoDia: () => apiJango().listCaixasAbertosDoDia(),
    inseriCaixaItemAbertura: () => apiJango().inseriCaixaItemAbertura(),
    aguardarMs: (ms) =>
        new Promise((resolve) => {
            setTimeout(resolve, ms);
        }),
};

let filaAberturaCaixa: Promise<unknown> = Promise.resolve();

function comLockAberturaCaixa<T>(fn: () => Promise<T>): Promise<T> {
    const executar = filaAberturaCaixa.then(fn, fn);
    filaAberturaCaixa = executar.then(
        () => undefined,
        () => undefined
    );
    return executar;
}

function toRegistro(caixa: CaixaResumoPdv): CaixaPdvRegistro {
    return {
        idCaixa: caixa.idCaixa,
        dataAbertura: caixa.dataAbertura,
        dataFechamento: caixa.dataFechamento,
        status: caixa.status,
    };
}

function validarCaixaAberto(
    caixa: CaixaResumoPdv | null,
    origem: string
): CaixaResumoPdv | null {
    if (!caixa) {
        return null;
    }
    if (
        !isCaixaPdvAberto({
            dataFechamento: caixa.dataFechamento,
            status: caixa.status,
        })
    ) {
        logger.warn('Hospedagem caixa PDV: registro ignorado (não aberto)', {
            origem,
            idCaixa: caixa.idCaixa,
            dataFechamento: caixa.dataFechamento,
            status: caixa.status,
        });
        return null;
    }
    return caixa;
}

async function aguardarCaixaAbertoAposTrigger(
    deps: GarantiaCaixaHospedagemDeps,
    contexto: GarantiaCaixaHospedagemContexto
): Promise<CaixaResumoPdv> {
    const tentativas = 5;
    const intervaloMs = 120;

    for (let i = 0; i < tentativas; i++) {
        const caixa = validarCaixaAberto(
            await deps.getCaixaAbertoDoDia(),
            'apos-abertura'
        );
        if (caixa) {
            return caixa;
        }
        if (i < tentativas - 1) {
            await deps.aguardarMs!(intervaloMs);
        }
    }

    const msg =
        'garantirCaixaJangoAbertoParaHospedagem: caixa aberto não encontrado após inseriCaixaItemAbertura';
    logger.error(msg, {
        ...contexto,
        tentativas,
    });
    throw new Error(msg);
}

/**
 * Garante um CAIXA aberto no dia (CURRENT_DATE Firebird) para lançamentos de hospedagem.
 * Retorna ID_CAIXA validado. Idempotente: reutiliza caixa aberto existente.
 */
export async function garantirCaixaAbertoHospedagemComDeps(
    deps: GarantiaCaixaHospedagemDeps = defaultDeps,
    contexto: GarantiaCaixaHospedagemContexto = {}
): Promise<number> {
    return comLockAberturaCaixa(async () => {
        const existente = validarCaixaAberto(
            await deps.getCaixaAbertoDoDia(),
            'consulta-inicial'
        );
        if (existente) {
            logger.info('Hospedagem caixa PDV: reutilizando caixa aberto', {
                ...contexto,
                idCaixa: existente.idCaixa,
                acao: 'reutilizar',
            });
            return existente.idCaixa;
        }

        logger.info('Hospedagem caixa PDV: nenhum caixa aberto hoje — abrindo', {
            ...contexto,
            acao: 'abrir',
        });

        let idCaixaItemAbertura: number;
        try {
            idCaixaItemAbertura = await deps.inseriCaixaItemAbertura();
        } catch (error) {
            const existenteAposErro = validarCaixaAberto(
                await deps.getCaixaAbertoDoDia(),
                'reconsulta-apos-erro-abertura'
            );
            if (existenteAposErro) {
                logger.warn(
                    'Hospedagem caixa PDV: abertura falhou mas caixa aberto apareceu (concorrência)',
                    {
                        ...contexto,
                        idCaixa: existenteAposErro.idCaixa,
                        erro: (error as Error)?.message,
                    }
                );
                return existenteAposErro.idCaixa;
            }
            logger.error('Hospedagem caixa PDV: falha em inseriCaixaItemAbertura', {
                ...contexto,
                erro: (error as Error)?.message,
            });
            throw error;
        }

        const caixaAberto = await aguardarCaixaAbertoAposTrigger(deps, contexto);

        const todosAbertos = (await deps.listCaixasAbertosDoDia()).map(toRegistro);
        const preferido = escolherCaixaAbertoPreferido(todosAbertos);
        if (preferido && preferido.idCaixa !== caixaAberto.idCaixa) {
            logger.warn(
                'Hospedagem caixa PDV: múltiplos caixas abertos — usando o de maior ID_CAIXA',
                {
                    ...contexto,
                    idCaixaEscolhido: preferido.idCaixa,
                    idCaixaAposAbertura: caixaAberto.idCaixa,
                    quantidadeAbertos: todosAbertos.length,
                }
            );
            return preferido.idCaixa;
        }

        if (todosAbertos.length > 1) {
            logger.warn('Hospedagem caixa PDV: mais de um caixa aberto no dia', {
                ...contexto,
                quantidadeAbertos: todosAbertos.length,
                ids: todosAbertos.map((c) => c.idCaixa),
            });
        }

        logger.info('Hospedagem caixa PDV: caixa aberto garantido', {
            ...contexto,
            idCaixa: caixaAberto.idCaixa,
            idCaixaItemAbertura,
            acao: 'aberto',
        });

        return caixaAberto.idCaixa;
    });
}

export async function garantirCaixaJangoAbertoParaHospedagem(
    contexto: GarantiaCaixaHospedagemContexto = {}
): Promise<number> {
    return garantirCaixaAbertoHospedagemComDeps(defaultDeps, contexto);
}

/** Expõe lock para testes de concorrência. */
export function __resetLockAberturaCaixaHospedagemParaTestes(): void {
    filaAberturaCaixa = Promise.resolve();
}
