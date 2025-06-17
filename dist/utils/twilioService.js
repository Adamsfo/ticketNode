"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendCodeSMS = sendCodeSMS;
exports.sendCodeWhatsApp = sendCodeWhatsApp;
// src/services/twilioService.ts
const twilio_1 = __importDefault(require("twilio"));
const accountSid = 'ACec10ac6037607a00971afc63f3582bf4';
const authToken = "b53c7b73c1af99613670b19a00b9f6a1";
const fromSms = "+18644287609";
const fromWhatsapp = 'whatsapp:' + "+18644287609";
const client = (0, twilio_1.default)(accountSid, authToken);
async function sendCodeSMS(to, code) {
    return client.messages.create({
        body: `Seu código de verificação é: ${code}. Não compartilhe com ninguém.`,
        from: fromSms,
        to,
    });
}
async function sendCodeWhatsApp(to, code) {
    return client.messages.create({
        body: `Seu código de verificação é: ${code}. Não compartilhe com ninguém.`,
        from: fromWhatsapp,
        to: 'whatsapp:' + to,
    });
}
