import { Resend } from 'resend';

export const resend = new Resend('re_85hsRhHe_8r52UQR8pcbnyecoCZX2oJJ3'); // Use sua API Key real aqui

/** Mesmo remetente e cliente Resend usados em AuthController. */
export const EMAIL_FROM = 'Jango Ingressos <no-reply@jangoingressos.com.br>';

export async function enviarEmailCliente(
    to: string,
    subject: string,
    html: string
): Promise<void> {
    if (!to) {
        throw new Error('E-mail é obrigatório');
    }

    const response = await resend.emails.send({
        from: EMAIL_FROM,
        to: [to],
        subject,
        html,
    });

    if (response.error) {
        throw new Error(
            response.error.message || 'Erro ao enviar e-mail via Resend.'
        );
    }
}
