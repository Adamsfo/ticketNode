// src/services/twilioService.ts
import twilio from 'twilio';

const accountSid = 'ACec10ac6037607a00971afc63f3582bf4';
const authToken = "b53c7b73c1af99613670b19a00b9f6a1";
const fromSms = "+18644287609";
const fromWhatsapp = 'whatsapp:' + "+18644287609";

const client = twilio(accountSid, authToken);

export async function sendCodeSMS(to: string, code: string) {
    return client.messages.create({
        body: `Seu código de verificação é: ${code}`,
        from: fromSms,
        to,
    });
}

export async function sendCodeWhatsApp(to: string, code: string) {
    return client.messages.create({
        body: `Seu código de verificação é: ${code}`,
        from: fromWhatsapp,
        to: 'whatsapp:' + to,
    });
}
