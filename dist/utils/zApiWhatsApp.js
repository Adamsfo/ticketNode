"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatPhoneToE164 = formatPhoneToE164;
exports.enviarMensagemTextoZApi = enviarMensagemTextoZApi;
/** Mesma integração Z-API utilizada em ModalVerificacao / ModalVerificacaoLogin. */
const ZAPI_INSTANCE_ID = '3E893A152BA131DB903DFA5FB5498E95';
const ZAPI_TOKEN = '9A4CDF91FE88589BDD9BA3FC';
const ZAPI_CLIENT_TOKEN = 'F891e8c3d58d84a7eac82cf030ef273faS';
function formatPhoneToE164(phone) {
    const cleaned = phone.replace(/\D/g, '');
    return cleaned.startsWith('55') ? `+${cleaned}` : `+55${cleaned}`;
}
async function enviarMensagemTextoZApi(phone, message) {
    const response = await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`, {
        method: 'POST',
        headers: {
            'Client-Token': ZAPI_CLIENT_TOKEN,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            phone: formatPhoneToE164(phone),
            message,
        }),
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Erro ao enviar mensagem via WhatsApp');
    }
}
