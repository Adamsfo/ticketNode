/**
 * Testes — WhatsApp manual vs automático no link de pagamento da hospedagem.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

describe('notificarLinkPagamentoHospedagem — opção enviarWhatsAppAutomatico', () => {
    it('só chama Z-API quando enviarWhatsAppAutomatico é true', () => {
        const src = readFileSync(
            join(__dirname, 'hospedagemConfirmacaoNotificacao.ts'),
            'utf8'
        );
        assert.match(src, /enviarWhatsAppAutomatico = options\?\.enviarWhatsAppAutomatico !== false/);
        assert.match(
            src,
            /if \(enviarWhatsAppAutomatico && conteudo\.telefone\)/
        );
        assert.match(src, /mensagemWhatsApp,/);
        assert.match(src, /telefone: conteudo\.telefone/);
    });
});

describe('chamadores de notificarLinkPagamentoHospedagem', () => {
    it('enviar para cliente e checkout link desativam WhatsApp automático', () => {
        const reservaSrc = readFileSync(
            join(__dirname, 'reservaSuiteService.ts'),
            'utf8'
        );
        assert.match(
            reservaSrc,
            /notificarLinkPagamentoHospedagem\(\s*resultado\.hospedagem\.id,\s*\{ enviarWhatsAppAutomatico: false \}/
        );
        assert.match(reservaSrc, /whatsappLinkPagamentoManual/);
    });

    it('reativação desativa WhatsApp automático e expõe dados manuais', () => {
        const src = readFileSync(
            join(__dirname, 'hospedagemReativacaoAdminService.ts'),
            'utf8'
        );
        assert.match(
            src,
            /notificarLinkPagamentoHospedagem\(idReserva, \{\s*enviarWhatsAppAutomatico: false,/
        );
        assert.match(src, /whatsappLinkPagamentoManual/);
    });

    it('reenviar link desativa WhatsApp automático e expõe dados manuais', () => {
        const src = readFileSync(
            join(__dirname, 'hospedagemAdminService.ts'),
            'utf8'
        );
        const reenviarBlock = src.slice(
            src.indexOf('reenviarLinkPagamentoReservaAdmin'),
            src.indexOf('function statusPermiteTrocaSuite')
        );
        assert.match(
            reenviarBlock,
            /notificarLinkPagamentoHospedagem\(reserva\.id, \{\s*enviarWhatsAppAutomatico: false,/
        );
        assert.match(reenviarBlock, /whatsappLinkPagamentoManual/);
    });
});

describe('confirmação de hospedagem', () => {
    it('continua usando Z-API em enviarWhatsAppConfirmacaoHospedagem', () => {
        const src = readFileSync(
            join(__dirname, 'hospedagemConfirmacaoNotificacao.ts'),
            'utf8'
        );
        assert.match(
            src,
            /export async function enviarWhatsAppConfirmacaoHospedagem/
        );
        assert.match(
            src,
            /await enviarMensagemTextoZApi\(\s*conteudo\.telefone,\s*montarMensagemWhatsAppConfirmacaoHospedagem\(conteudo\)/
        );
    });
});
