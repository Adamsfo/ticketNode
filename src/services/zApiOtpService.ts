import { enviarMensagemTextoZApi } from '../utils/zApiWhatsApp';

/** Mesmo texto usado anteriormente em ModalVerificacao (ativação de conta). */
export function montarMensagemCodigoAtivacaoWhatsApp(codigo: string): string {
    return `🔐 Seu código de verificação no Jango Ingressos é: ${codigo}.
Não compartilhe com ninguém.`;
}

/** Mesmo texto usado anteriormente em ModalVerificacaoLogin (login por código). */
export function montarMensagemCodigoLoginWhatsApp(codigo: string): string {
    return `🔐 Seu código para entrar no Jango Ingressos é: ${codigo}.
Não compartilhe com ninguém.`;
}

export async function enviarCodigoAtivacaoWhatsApp(
    telefone: string,
    codigo: string
): Promise<void> {
    await enviarMensagemTextoZApi(
        telefone,
        montarMensagemCodigoAtivacaoWhatsApp(codigo)
    );
}

export async function enviarCodigoLoginWhatsApp(
    telefone: string,
    codigo: string
): Promise<void> {
    await enviarMensagemTextoZApi(
        telefone,
        montarMensagemCodigoLoginWhatsApp(codigo)
    );
}
