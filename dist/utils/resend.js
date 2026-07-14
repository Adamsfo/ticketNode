"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMAIL_FROM = exports.resend = void 0;
exports.enviarEmailCliente = enviarEmailCliente;
const resend_1 = require("resend");
exports.resend = new resend_1.Resend('re_85hsRhHe_8r52UQR8pcbnyecoCZX2oJJ3'); // Use sua API Key real aqui
/** Mesmo remetente e cliente Resend usados em AuthController. */
exports.EMAIL_FROM = 'Jango Ingressos <no-reply@jangoingressos.com.br>';
async function enviarEmailCliente(to, subject, html) {
    if (!to) {
        throw new Error('E-mail é obrigatório');
    }
    const response = await exports.resend.emails.send({
        from: exports.EMAIL_FROM,
        to: [to],
        subject,
        html,
    });
    if (response.error) {
        throw new Error(response.error.message || 'Erro ao enviar e-mail via Resend.');
    }
}
