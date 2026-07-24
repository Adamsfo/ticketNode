"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendCodeSMS = sendCodeSMS;
exports.sendCodeWhatsApp = sendCodeWhatsApp;
// src/services/twilioService.ts
const twilio_1 = __importDefault(require("twilio"));
const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
const authToken = process.env.TWILIO_AUTH_TOKEN || "";
const fromSms = process.env.TWILIO_FROM_SMS || "";
const fromWhatsapp = "whatsapp:" + fromSms;
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
        to: "whatsapp:" + to,
    });
}
