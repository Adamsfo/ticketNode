/** Mesma integração Z-API utilizada em ModalVerificacao / ModalVerificacaoLogin. */
const ZAPI_INSTANCE_ID = process.env.ZAPI_INSTANCE_ID || "";
const ZAPI_TOKEN = process.env.ZAPI_TOKEN || "";
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN || "";

export function formatPhoneToE164(phone: string): string {
  const cleaned = phone.replace(/\D/g, "");
  return cleaned.startsWith("55") ? `+${cleaned}` : `+55${cleaned}`;
}

export async function enviarMensagemTextoZApi(
  phone: string,
  message: string
): Promise<void> {
  const response = await fetch(
    `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`,
    {
      method: "POST",
      headers: {
        "Client-Token": ZAPI_CLIENT_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone: formatPhoneToE164(phone),
        message,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Erro ao enviar mensagem via WhatsApp");
  }
}
