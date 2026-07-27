import { formatInTimeZone } from 'date-fns-tz';
import { Evento } from '../models/Evento';
import { ReservaHospedagem } from '../models/ReservaHospedagem';
import { ReservaSuite } from '../models/ReservaSuite';
import { EventoSuite } from '../models/EventoSuite';
import { Usuario } from '../models/Usuario';
import { HistoricoTransacao } from '../models/Transacao';
import { enviarEmailCliente } from '../utils/resend';
import { montarUrlPublicaReserva } from '../utils/siteUrl';
import { enviarMensagemTextoZApi } from '../utils/zApiWhatsApp';
import { toNumber } from '../utils/reservaSuiteUtils';

export { montarUrlPublicaReserva };

export type SuiteConfirmacaoNotificacao = {
    nome: string;
    adultos: number;
    criancas: number;
};

/** Conteúdo base da confirmação — extensível para PDF, QR Code, mapa, etc. */
export type HospedagemConfirmacaoConteudo = {
    idReserva: number;
    idTransacao: number;
    idUsuario: number;
    nomeCliente: string;
    email: string;
    telefone: string;
    nomeEvento: string;
    checkin: string;
    checkout: string;
    noites: number;
    suites: SuiteConfirmacaoNotificacao[];
    valorTotal: string;
};

function formatarDataHospedagem(data: Date): string {
    return formatInTimeZone(data, 'America/Cuiaba', 'dd/MM/yyyy HH:mm');
}

function formatarMoeda(valor: number): string {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarHospedesWhatsApp(adultos: number, criancas: number): string {
    const linhas: string[] = [];
    if (adultos > 0) {
        linhas.push(`${adultos} ${adultos === 1 ? 'adulto' : 'adultos'}`);
    }
    if (criancas > 0) {
        linhas.push(`${criancas} ${criancas === 1 ? 'criança' : 'crianças'}`);
    }
    return linhas.map((linha) => `  ${linha}`).join('\n');
}

export async function carregarConteudoConfirmacaoHospedagem(
    idReservaHospedagem: number,
    idTransacao: number
): Promise<HospedagemConfirmacaoConteudo | null> {
    const hospedagem = await ReservaHospedagem.findByPk(idReservaHospedagem, {
        include: [
            { model: Usuario, as: 'Usuario' },
            { model: Evento, as: 'Evento' },
            {
                model: ReservaSuite,
                as: 'ReservaSuite',
                include: [{ model: EventoSuite, as: 'EventoSuite' }],
            },
        ],
    });

    if (!hospedagem) {
        return null;
    }

    const usuario = (hospedagem as ReservaHospedagem & { Usuario?: Usuario }).Usuario;
    const evento = (hospedagem as ReservaHospedagem & { Evento?: Evento }).Evento;
    const suites = (hospedagem as ReservaHospedagem & {
        ReservaSuite?: Array<ReservaSuite & { EventoSuite?: EventoSuite }>;
    }).ReservaSuite ?? [];

    return {
        idReserva: hospedagem.id,
        idTransacao,
        idUsuario: hospedagem.idUsuario,
        nomeCliente: usuario?.nomeCompleto || 'Cliente',
        email: usuario?.email ?? '',
        telefone: usuario?.telefone ?? '',
        nomeEvento: evento?.nome ?? 'Pousada',
        checkin: formatarDataHospedagem(hospedagem.checkin),
        checkout: formatarDataHospedagem(hospedagem.checkout),
        noites: hospedagem.noites,
        suites: suites.map((suite) => ({
            nome: suite.EventoSuite?.nome ?? `Suíte ${suite.idEventoSuite}`,
            adultos: suite.adultos,
            criancas: suite.criancas,
        })),
        valorTotal: formatarMoeda(toNumber(hospedagem.valorTotal)),
    };
}

export function montarHtmlEmailConfirmacaoHospedagem(
    conteudo: HospedagemConfirmacaoConteudo
): string {
    const suitesHtml = conteudo.suites
        .map(
            (suite) => `
        <li style="margin-bottom: 8px;">
          <strong>${suite.nome}</strong><br/>
          ${suite.adultos} adulto(s), ${suite.criancas} criança(s)
        </li>`
        )
        .join('');

    return `
    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.5;">
      <h2>Reserva confirmada</h2>
      <p>Olá, <strong>${conteudo.nomeCliente}</strong>!</p>
      <p>Sua hospedagem foi confirmada com sucesso.</p>
      <p><strong>Número da reserva:</strong> ${conteudo.idReserva}</p>
      <p><strong>Evento/Pousada:</strong> ${conteudo.nomeEvento}</p>
      <p><strong>Check-in:</strong> ${conteudo.checkin}</p>
      <p><strong>Check-out:</strong> ${conteudo.checkout}</p>
      <p><strong>Diárias:</strong> ${conteudo.noites}</p>
      <p><strong>Suítes reservadas:</strong></p>
      <ul>${suitesHtml}</ul>
      <p><strong>Valor pago:</strong> ${conteudo.valorTotal}</p>
      <p>Obrigado por escolher a Jango Ingressos. Aguardamos você!</p>
      <br/>
      <small>Jango Ingressos © ${new Date().getFullYear()}</small>
    </div>
  `;
}

export function montarMensagemWhatsAppConfirmacaoHospedagem(
    conteudo: HospedagemConfirmacaoConteudo
): string {
    const suitesTexto = conteudo.suites
        .map((suite) => {
            const hospedes = formatarHospedesWhatsApp(suite.adultos, suite.criancas);
            return `- Suíte ${suite.nome}\n${hospedes}`;
        })
        .join('\n\n');

    return `✅ Reserva confirmada

Evento: ${conteudo.nomeEvento}
Check-in: ${conteudo.checkin}
Check-out: ${conteudo.checkout}
Diárias: ${conteudo.noites}

Suítes:

${suitesTexto}

Valor total: ${conteudo.valorTotal}

Aguardamos você! Em caso de dúvidas entre em contato conosco.`;
}

export async function enviarEmailConfirmacaoHospedagem(
    conteudo: HospedagemConfirmacaoConteudo
): Promise<void> {
    if (!conteudo.email) {
        throw new Error('E-mail do usuário não informado.');
    }

    console.log('Enviando e-mail');

    await enviarEmailCliente(
        conteudo.email,
        `Reserva confirmada - ${conteudo.nomeEvento}`,
        montarHtmlEmailConfirmacaoHospedagem(conteudo)
    );

    console.log('E-mail enviado');
}

export async function enviarWhatsAppConfirmacaoHospedagem(
    conteudo: HospedagemConfirmacaoConteudo
): Promise<void> {
    if (!conteudo.telefone) {
        throw new Error('Telefone do usuário não informado.');
    }

    console.log('Enviando WhatsApp');

    await enviarMensagemTextoZApi(
        conteudo.telefone,
        montarMensagemWhatsAppConfirmacaoHospedagem(conteudo)
    );

    console.log('WhatsApp enviado');
}

async function registrarFalhaEnvioConfirmacao(
    conteudo: HospedagemConfirmacaoConteudo,
    canal: 'e-mail' | 'WhatsApp',
    error: unknown
): Promise<void> {
    const mensagemErro =
        error instanceof Error ? error.message : 'Erro desconhecido';

    if (canal === 'e-mail') {
        console.error('Erro ao enviar e-mail:', error);
    } else {
        console.error('Erro ao enviar WhatsApp:', error);
    }

    try {
        await HistoricoTransacao.create({
            idTransacao: conteudo.idTransacao,
            idUsuario: conteudo.idUsuario,
            data: new Date(),
            descricao: `Falha no envio da confirmação de hospedagem por ${canal}: ${mensagemErro}`,
        });
    } catch (historicoError) {
        console.error(
            'Erro ao registrar falha de envio no histórico da transação:',
            historicoError
        );
    }
}

export async function notificarConfirmacaoHospedagem(
    idReservaHospedagem: number,
    idTransacao: number
): Promise<void> {
    const conteudo = await carregarConteudoConfirmacaoHospedagem(
        idReservaHospedagem,
        idTransacao
    );

    if (!conteudo) {
        console.error(
            `Conteúdo de notificação não encontrado para reserva ${idReservaHospedagem}.`
        );
        return;
    }

    try {
        await enviarEmailConfirmacaoHospedagem(conteudo);
    } catch (error) {
        await registrarFalhaEnvioConfirmacao(conteudo, 'e-mail', error);
    }

    try {
        await enviarWhatsAppConfirmacaoHospedagem(conteudo);
    } catch (error) {
        await registrarFalhaEnvioConfirmacao(conteudo, 'WhatsApp', error);
    }
}

export type HospedagemLinkPagamentoConteudo = HospedagemConfirmacaoConteudo & {
    linkPagamento: string;
};

export function montarMensagemWhatsAppLinkPagamentoHospedagem(
    conteudo: HospedagemLinkPagamentoConteudo
): string {
    return `Olá, ${conteudo.nomeCliente}.

Sua reserva foi criada com sucesso.

Para concluir sua reserva e efetuar o pagamento, acesse:

${conteudo.linkPagamento}`;
}

export function montarHtmlEmailLinkPagamentoHospedagem(
    conteudo: HospedagemLinkPagamentoConteudo
): string {
    return `
    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.5;">
      <h2>Finalize sua reserva</h2>
      <p>Olá, <strong>${conteudo.nomeCliente}</strong>!</p>
      <p>Sua reserva foi criada com sucesso.</p>
      <p><strong>Número da reserva:</strong> ${conteudo.idReserva}</p>
      <p><strong>Pousada:</strong> ${conteudo.nomeEvento}</p>
      <p><strong>Check-in:</strong> ${conteudo.checkin}</p>
      <p><strong>Check-out:</strong> ${conteudo.checkout}</p>
      <p><strong>Valor total:</strong> ${conteudo.valorTotal}</p>
      <p>Para concluir sua reserva e efetuar o pagamento, acesse:</p>
      <p><a href="${conteudo.linkPagamento}" style="color:#0b5fff;">${conteudo.linkPagamento}</a></p>
      <br/>
      <small>Jango Ingressos © ${new Date().getFullYear()}</small>
    </div>
  `;
}

/**
 * Envia link de pagamento reutilizando Z-API e Resend já existentes.
 * Não altera o fluxo de confirmação pós-pagamento.
 */
export async function notificarLinkPagamentoHospedagem(
    idReservaHospedagem: number
): Promise<{ linkPagamento: string }> {
    const hospedagem = await ReservaHospedagem.findByPk(idReservaHospedagem);
    if (!hospedagem?.tokenPagamento || !hospedagem.idTransacao) {
        throw new Error('Reserva sem token/transação para envio do link.');
    }

    const base = await carregarConteudoConfirmacaoHospedagem(
        idReservaHospedagem,
        hospedagem.idTransacao
    );
    if (!base) {
        throw new Error('Conteúdo da reserva não encontrado para envio do link.');
    }

    const linkPagamento = montarUrlPublicaReserva(hospedagem.tokenPagamento);
    const conteudo: HospedagemLinkPagamentoConteudo = {
        ...base,
        linkPagamento,
    };

    try {
        if (conteudo.email) {
            await enviarEmailCliente(
                conteudo.email,
                `Finalize sua reserva - ${conteudo.nomeEvento}`,
                montarHtmlEmailLinkPagamentoHospedagem(conteudo)
            );
        }
    } catch (error) {
        await registrarFalhaEnvioConfirmacao(conteudo, 'e-mail', error);
    }

    try {
        if (conteudo.telefone) {
            await enviarMensagemTextoZApi(
                conteudo.telefone,
                montarMensagemWhatsAppLinkPagamentoHospedagem(conteudo)
            );
        }
    } catch (error) {
        await registrarFalhaEnvioConfirmacao(conteudo, 'WhatsApp', error);
    }

    hospedagem.linkPagamentoEnviadoEm = new Date();
    await hospedagem.save();

    try {
        await HistoricoTransacao.create({
            idTransacao: conteudo.idTransacao,
            idUsuario: conteudo.idUsuario,
            data: new Date(),
            descricao: `Link de pagamento enviado ao cliente: ${linkPagamento}`,
        });
    } catch (error) {
        console.error('Erro ao registrar envio do link no histórico:', error);
    }

    return { linkPagamento };
}
