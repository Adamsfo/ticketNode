/**
 * Testes — prazo do link de pagamento e notificação de expiração de hospedagem.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_key';

import {
    montarHtmlEmailExpiracaoHospedagem,
    montarHtmlEmailLinkPagamentoHospedagem,
    montarMensagemWhatsAppExpiracaoHospedagem,
    montarMensagemWhatsAppLinkPagamentoHospedagem,
    type HospedagemConfirmacaoConteudo,
    type HospedagemLinkPagamentoConteudo,
} from './hospedagemConfirmacaoNotificacao';

const conteudoBase: HospedagemConfirmacaoConteudo = {
    idReserva: 42,
    idTransacao: 100,
    idUsuario: 7,
    nomeCliente: 'Maria Silva',
    email: 'maria@example.com',
    telefone: '65999999999',
    nomeEvento: 'Pesque Pague Jango',
    checkin: '10/10/2026 16:00',
    checkout: '12/10/2026 13:00',
    dataEntrada: '10/10/2026',
    dataSaida: '12/10/2026',
    noites: 2,
    suites: [{ nome: 'Suíte 1', adultos: 2, criancas: 0 }],
    valorTotal: 'R$ 500,00',
};

const conteudoLink: HospedagemLinkPagamentoConteudo = {
    ...conteudoBase,
    linkPagamento: 'https://example.com/reserva/abc123',
};

describe('constantes de expiração em reservaSuiteService', () => {
    it('mantém 30 minutos no link e 15 minutos no checkout legado', () => {
        const src = readFileSync(
            join(__dirname, 'reservaSuiteService.ts'),
            'utf8'
        );
        assert.match(src, /export const MINUTOS_EXPIRACAO_LINK_PAGAMENTO = 30;/);
        assert.match(src, /const MINUTOS_EXPIRACAO_RESERVA = 15;/);
    });
});

describe('montarHtmlEmailLinkPagamentoHospedagem', () => {
    it('informa prazo de 30 minutos no e-mail do link', () => {
        const html = montarHtmlEmailLinkPagamentoHospedagem(conteudoLink);
        assert.match(html, /30 minutos/);
        assert.match(
            html,
            /Após esse prazo, a reserva será cancelada automaticamente/
        );
    });
});

describe('montarMensagemWhatsAppLinkPagamentoHospedagem', () => {
    it('informa prazo de 30 minutos no WhatsApp do link', () => {
        const mensagem =
            montarMensagemWhatsAppLinkPagamentoHospedagem(conteudoLink);
        assert.match(mensagem, /30 minutos/);
        assert.match(
            mensagem,
            /Após esse prazo, a reserva será cancelada automaticamente/
        );
    });
});

describe('montarHtmlEmailExpiracaoHospedagem', () => {
    it('informa cancelamento por falta de pagamento em 30 minutos', () => {
        const html = montarHtmlEmailExpiracaoHospedagem(conteudoBase);
        assert.match(html, /Maria Silva/);
        assert.match(html, /cancelada porque o pagamento não foi realizado/);
        assert.match(html, /prazo de 30 minutos/);
        assert.match(html, /Reserva:<\/strong> 42/);
        assert.match(html, /Check-in:<\/strong> 10\/10\/2026/);
        assert.match(html, /Check-out:<\/strong> 12\/10\/2026/);
        assert.match(html, /Pesque Pague Jango/);
    });

    it('orienta nova reserva pelo site www.jangoingressos.com.br', () => {
        const html = montarHtmlEmailExpiracaoHospedagem(conteudoBase);
        assert.match(html, /www\.jangoingressos\.com\.br/);
        assert.match(
            html,
            /href="https:\/\/www\.jangoingressos\.com\.br"/
        );
    });
});

describe('montarMensagemWhatsAppExpiracaoHospedagem', () => {
    it('informa cancelamento, prazo de 30 minutos e site para nova reserva', () => {
        const mensagem =
            montarMensagemWhatsAppExpiracaoHospedagem(conteudoBase);
        assert.match(mensagem, /Maria Silva/);
        assert.match(mensagem, /cancelada porque o pagamento não foi realizado/);
        assert.match(mensagem, /prazo de 30 minutos/);
        assert.match(mensagem, /www\.jangoingressos\.com\.br/);
        assert.match(mensagem, /sujeita à disponibilidade/);
        assert.match(mensagem, /Pesque Pague Jango/);
    });
});

describe('notificarExpiracaoHospedagem', () => {
    it('tenta enviar e-mail e WhatsApp de forma independente', () => {
        const src = readFileSync(
            join(__dirname, 'hospedagemConfirmacaoNotificacao.ts'),
            'utf8'
        );
        assert.match(src, /await enviarEmailCliente\(/);
        assert.match(src, /await enviarMensagemTextoZApi\(/);
        assert.match(
            src,
            /montarMensagemWhatsAppExpiracaoHospedagem\(conteudo\)/
        );
        assert.match(
            src,
            /Erro ao enviar e-mail de expiração da reserva \$\{idReservaHospedagem\}:/
        );
        assert.match(
            src,
            /Erro ao enviar WhatsApp de expiração da reserva \$\{idReservaHospedagem\}:/
        );
    });
});

describe('marcarReservaComoExpirada dispara notificação', () => {
    it('chama notificarExpiracaoHospedagem após marcar como Expirada', () => {
        const src = readFileSync(
            join(__dirname, 'reservaSuiteService.ts'),
            'utf8'
        );
        assert.match(src, /await notificarExpiracaoHospedagem\(idReserva\)/);
        assert.match(
            src,
            /if \(hospedagem\.status !== StatusReservaHospedagem\.AguardandoPagamento\)/
        );
    });
});
