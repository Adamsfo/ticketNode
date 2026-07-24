"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMAIL_FROM = exports.resend = void 0;
exports.enviarEmailCliente = enviarEmailCliente;
const resend_1 = require("resend");
exports.resend = new resend_1.Resend(process.env.RESEND_API_KEY || "");
/** Mesmo remetente e cliente Resend usados em AuthController. */
exports.EMAIL_FROM = process.env.EMAIL_FROM ||
    "Jango Ingressos <no-reply@jangoingressos.com.br>";
async function enviarEmailCliente(to, subject, html) {
    if (!to) {
        throw new Error("E-mail é obrigatório");
    }
    const response = await exports.resend.emails.send({
        from: exports.EMAIL_FROM,
        to: [to],
        subject,
        html,
    });
    if (response.error) {
        throw new Error(response.error.message || "Erro ao enviar e-mail via Resend.");
    }
}
