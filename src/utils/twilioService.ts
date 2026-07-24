// src/services/twilioService.ts
import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
const authToken = process.env.TWILIO_AUTH_TOKEN || "";
const fromSms = process.env.TWILIO_FROM_SMS || "";
const fromWhatsapp = "whatsapp:" + fromSms;

const client = twilio(accountSid, authToken);

export async function sendCodeSMS(to: string, code: string) {
  return client.messages.create({
    body: `Seu código de verificação é: ${code}. Não compartilhe com ninguém.`,
    from: fromSms,
    to,
  });
}

export async function sendCodeWhatsApp(to: string, code: string) {
  return client.messages.create({
    body: `Seu código de verificação é: ${code}. Não compartilhe com ninguém.`,
    from: fromWhatsapp,
    to: "whatsapp:" + to,
  });
}
