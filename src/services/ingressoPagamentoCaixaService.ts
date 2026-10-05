import apiJango from '../api/apiJango';
import { logger } from '../utils/logger';
import { garantirCaixaJangoAbertoParaHospedagem } from './hospedagemCaixaGarantia';

const ID_FORMA_PAGAMENTO_CAIXA_DINHEIRO = 38;

export type TentarLancarCaixaIngressoDinheiroParams = {
    idTransacao: number;
    idTransacaoPagamento: number;
    valorTotal: number;
};

/**
 * Lança CAIXA_ITEM para ingresso em dinheiro (produtor 1).
 * Falhas do PDV são apenas logadas — nunca propagadas (pagamento do ingresso é prioritário).
 */
export async function tentarLancarCaixaItemIngressoDinheiro(
    params: TentarLancarCaixaIngressoDinheiroParams
): Promise<number | null> {
    const contexto = {
        idTransacao: params.idTransacao,
        idTransacaoPagamento: params.idTransacaoPagamento,
        formaPagamento: 'Dinheiro',
        origem: 'ingresso_pagamentoDinheiro',
    };

    let idCaixa: number;
    try {
        idCaixa = await garantirCaixaJangoAbertoParaHospedagem(contexto);
    } catch (error) {
        logger.error(
            'Ingresso caixa PDV: falha ao garantir caixa aberto (pagamento segue)',
            {
                ...contexto,
                valorTotal: params.valorTotal,
                erro: (error as Error)?.message,
            }
        );
        return null;
    }

    try {
        const idCaixaItem = await apiJango().inseriCaixaItem(
            String(idCaixa),
            Number(params.valorTotal) || 0,
            ID_FORMA_PAGAMENTO_CAIXA_DINHEIRO,
            params.idTransacaoPagamento
        );

        if (!Number.isFinite(idCaixaItem) || idCaixaItem <= 0) {
            logger.warn(
                'Ingresso caixa PDV: inseriCaixaItem não retornou ID válido (pagamento segue)',
                {
                    ...contexto,
                    idCaixa,
                    idCaixaItem,
                    valorTotal: params.valorTotal,
                }
            );
            return null;
        }

        logger.info('Ingresso caixa PDV: CAIXA_ITEM lançado', {
            ...contexto,
            idCaixa,
            idCaixaItem,
            valorTotal: params.valorTotal,
        });
        return idCaixaItem;
    } catch (error) {
        logger.error(
            'Ingresso caixa PDV: falha ao inserir CAIXA_ITEM (pagamento segue)',
            {
                ...contexto,
                idCaixa,
                valorTotal: params.valorTotal,
                erro: (error as Error)?.message,
            }
        );
        return null;
    }
}
