import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    LIMITE_DESCRICAO_HISTORICO_TRANSACAO,
    limitarDescricaoHistorico,
    montarDescricaoHistoricoCheckoutHospedagem,
} from './reservaSuiteService';

describe('montarDescricaoHistoricoCheckoutHospedagem', () => {
    const baseLink = {
        isLinkCliente: true,
        isRecepcao: true,
        confirmaImediatamente: false,
        linhasDescontoHistorico: [] as string[],
        taxasAdicionais: [] as Array<{
            descricao: string;
            valor: number;
            ordem: number;
            idEventoSuite: number;
        }>,
        valorTotalReserva: 280,
        valorPagoRecepcao: 0,
        saldoPendenteRecepcao: 280,
        percentualLink: 50 as const,
        valorCobrancaInicialTransacao: 140,
        possuiLinkPagamento: true,
    };

    it('link 50% sem taxa adicional — cabe em 255 e sem URL', () => {
        const descricao = montarDescricaoHistoricoCheckoutHospedagem(baseLink);
        assert.ok(descricao.length <= LIMITE_DESCRICAO_HISTORICO_TRANSACAO);
        assert.match(descricao, /aguardando pagamento do cliente \(link\)/);
        assert.match(descricao, /Cobrança inicial: 50%/);
        assert.match(descricao, /Link de pagamento gerado/);
        assert.doesNotMatch(descricao, /https?:\/\//);
    });

    it('link 50% com taxa adicional 100 — não estoura VARCHAR(255)', () => {
        const descricao = montarDescricaoHistoricoCheckoutHospedagem({
            ...baseLink,
            valorTotalReserva: 380,
            saldoPendenteRecepcao: 380,
            valorCobrancaInicialTransacao: 190,
            taxasAdicionais: [
                {
                    descricao: 'teste',
                    valor: 100,
                    ordem: 1,
                    idEventoSuite: 3,
                },
            ],
        });
        assert.ok(descricao.length <= LIMITE_DESCRICAO_HISTORICO_TRANSACAO);
        assert.match(descricao, /Taxas adicionais:.*100/);
        assert.match(descricao, /Cobrança inicial: 50%.*190/);
        assert.doesNotMatch(descricao, /https?:\/\//);
    });

    it('taxa com descrição enorme ainda respeita limite (só total das taxas)', () => {
        const descricao = montarDescricaoHistoricoCheckoutHospedagem({
            ...baseLink,
            taxasAdicionais: [
                {
                    descricao: 'X'.repeat(500),
                    valor: 100,
                    ordem: 1,
                    idEventoSuite: 1,
                },
            ],
        });
        assert.ok(descricao.length <= LIMITE_DESCRICAO_HISTORICO_TRANSACAO);
        assert.doesNotMatch(descricao, /X{50}/);
    });
});

describe('limitarDescricaoHistorico', () => {
    it('texto curto permanece igual', () => {
        assert.equal(limitarDescricaoHistorico('ok'), 'ok');
    });

    it('texto artificialmente longo é limitado a 255', () => {
        const longo = 'a'.repeat(400);
        const limitado = limitarDescricaoHistorico(longo);
        assert.equal(limitado.length, LIMITE_DESCRICAO_HISTORICO_TRANSACAO);
        assert.ok(longo.startsWith(limitado.slice(0, 254)));
    });
});
