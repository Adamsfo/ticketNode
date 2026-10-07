/**
 * node --require ts-node/register/transpile-only --test \
 *   src/services/hospedagemNotificacaoOperador7192.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    ID_USUARIO_CRIACAO_NOTIFICACAO_OPERADOR_7192,
    isReservaElegivelNotificacaoOperador7192,
    montarMensagemWhatsAppConfirmacaoOperador7192,
    montarMensagemWhatsAppExpiracaoOperador7192,
} from './hospedagemNotificacaoOperador7192';
import type { HospedagemConfirmacaoConteudo } from './hospedagemConfirmacaoNotificacao';

const conteudoBase: HospedagemConfirmacaoConteudo = {
    idReserva: 42,
    idTransacao: 1,
    idUsuario: 999,
    nomeCliente: 'Maria Silva',
    email: 'maria@test.com',
    telefone: '65999999999',
    nomeEvento: 'Pousada',
    checkin: '10/10/2026 14:00',
    checkout: '12/10/2026 11:00',
    dataEntrada: '10/10/2026',
    dataSaida: '12/10/2026',
    noites: 2,
    suites: [{ nome: 'Suíte Master', adultos: 2, criancas: 0 }],
    valorTotal: 'R$ 1.000,00',
    valorTotalReserva: 1000,
    valorPago: 1000,
    saldoPendente: 0,
};

describe('isReservaElegivelNotificacaoOperador7192', () => {
    it('recepção + criador 7192 → elegível', () => {
        assert.equal(
            isReservaElegivelNotificacaoOperador7192({
                origemReserva: 'ATENDENTE',
                idUsuarioCriacao: ID_USUARIO_CRIACAO_NOTIFICACAO_OPERADOR_7192,
            }),
            true
        );
    });

    it('recepção + criador 5000 → não elegível', () => {
        assert.equal(
            isReservaElegivelNotificacaoOperador7192({
                origemReserva: 'ATENDENTE',
                idUsuarioCriacao: 5000,
            }),
            false
        );
    });

    it('site + criador 7192 → não elegível', () => {
        assert.equal(
            isReservaElegivelNotificacaoOperador7192({
                origemReserva: 'CLIENTE',
                idUsuarioCriacao: ID_USUARIO_CRIACAO_NOTIFICACAO_OPERADOR_7192,
            }),
            false
        );
    });

    it('cliente 7192 em idUsuario (hóspede) sem ATENDENTE → não elegível', () => {
        assert.equal(
            isReservaElegivelNotificacaoOperador7192({
                origemReserva: 'CLIENTE',
                idUsuarioCriacao: null,
            }),
            false
        );
    });
});

describe('mensagens WhatsApp operador 7192', () => {
    it('confirmação inclui dados da reserva', () => {
        const msg = montarMensagemWhatsAppConfirmacaoOperador7192(conteudoBase);
        assert.match(msg, /Reserva confirmada/);
        assert.match(msg, /Maria Silva/);
        assert.match(msg, /#42/);
        assert.match(msg, /Suíte Master/);
    });

    it('expiração inclui dados da reserva', () => {
        const msg = montarMensagemWhatsAppExpiracaoOperador7192(conteudoBase);
        assert.match(msg, /Reserva expirada/);
        assert.match(msg, /Maria Silva/);
        assert.match(msg, /#42/);
    });
});
