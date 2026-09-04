import { formatInTimeZone } from 'date-fns-tz';
import { Evento } from '../models/Evento';
import { ReservaHospedagem, StatusReservaHospedagem } from '../models/ReservaHospedagem';
import { ReservaSuite } from '../models/ReservaSuite';
import { EventoSuite } from '../models/EventoSuite';
import { Usuario } from '../models/Usuario';
import { HistoricoTransacao } from '../models/Transacao';
import { enviarEmailCliente } from '../utils/resend';
import { montarUrlPublicaReserva } from '../utils/siteUrl';
import { enviarMensagemTextoZApi } from '../utils/zApiWhatsApp';
import { toNumber } from '../utils/reservaSuiteUtils';
import { shouldSendAutomaticConfirmation } from './ReservationNotificationPolicy';

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
    dataEntrada: string;
    dataSaida: string;
    noites: number;
    suites: SuiteConfirmacaoNotificacao[];
    valorTotal: string;
};

function formatarDataHospedagem(data: Date): string {
    return formatInTimeZone(data, 'America/Cuiaba', 'dd/MM/yyyy HH:mm');
}

function formatarDataHospedagemSomenteData(data: Date): string {
    return formatInTimeZone(data, 'America/Cuiaba', 'dd/MM/yyyy');
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
        dataEntrada: formatarDataHospedagemSomenteData(hospedagem.checkin),
        dataSaida: formatarDataHospedagemSomenteData(hospedagem.checkout),
        noites: hospedagem.noites,
        suites: suites.map((suite) => ({
            nome: suite.EventoSuite?.nome ?? `Suíte ${suite.idEventoSuite}`,
            adultos: suite.adultos,
            criancas: suite.criancas,
        })),
        valorTotal: formatarMoeda(toNumber(hospedagem.valorTotal)),
    };
}

export function montarTextoPlanoConfirmacaoHospedagem(
    conteudo: HospedagemConfirmacaoConteudo
): string {
    const { nomeCliente, dataEntrada, dataSaida } = conteudo;

    return `✅ Reserva confirmada – PESQUE PAGUE JANGO

Olá, ${nomeCliente}!
Passando para confirmar sua reserva conosco. Abaixo seguem todas as informações importantes para garantir sua melhor experiência. Por favor, leia com atenção:

⸻

INFORMAÇÕES GERAIS DA SUA RESERVA
• Entrada no pesqueiro: a partir das 14h do dia ${dataEntrada}
• Check-in no quarto: a partir das 16h, com prazo máximo até 19h
• Check-out do quarto: entre 08h e 13h do dia ${dataSaida}
• Após o check-out, você pode continuar no pesqueiro até as 17h30, aproveitando nossa área de lazer.
• ATENÇÃO: cascata e escorregador não funcionam após as 17h, sendo religados no outro dia às 08h.

⸻

O QUE ESTÁ INCLUSO NA DIÁRIA
• Café da manhã: servido das 08h às 10h
• Piscinas liberadas durante todo o dia e noite
• Pesca esportiva (pesque e solte) – em horário livre para hóspedes

⸻

O QUE NÃO ESTÁ INCLUSO
• Almoço
• Jantar
• Bebidas
• Iscas
• Material de pesca

⸻

SOBRE PESCA E EQUIPAMENTOS
• Pode trazer seu próprio equipamento e iscas
• Proibido trazer ração – pois é feito controle pelo pesqueiro para garantir a qualidade da água e a saúde dos peixes
• Temos à disposição:
• Aluguel de vara com molinete: R$ 30,00 a diária
• Isca (salsicha): R$ 4,00 o copo. Outras que variam de valores até R$ 26,00.
• Balde de ração: R$ 20,00 (1 por pescador)

⸻

ALIMENTAÇÃO
• Jantar:
• Pedido obrigatoriamente até as 17h30. Se não chegar a tempo, pode pedir por WhatsApp.
• O bar fecha às 19h para hóspedes – garanta suas bebidas com antecedência.
• Almoço (finais de semana e feriados): Servido das 12h às 14h, sistema buffet a R$ 99,90/kg
• Almoço (dias de semana): À la carte, conforme cardápio

⸻

WI-FI DISPONÍVEL
Senha: 12345678

⸻

IMPORTANTE – REGRAS DO PESQUEIRO

❌ Proibida a entrada de pet.

• Proibida entrada com comida ou bebida
• Proibida entrada com caixa térmica
• Proibido uso de caixa de som
• Proibido fazer churrasco nas dependências
• Proibido uso de linha multifilamento
• Recomendamos linha monofilamento 0.35mm ou superior
• Anzol com fisga não é permitido (pode usar sem fisga ou amassar a fisga)
• Proibido uso de alicate de contenção
• Proibido uso de iscas artificiais.

* SE HOUVER DESCUMPRIMENTO DE QUALQUER REGRA SERÁ COBRADA MULTA.

⸻

POLÍTICA DE CANCELAMENTO
• Não há reembolso do valor pago antecipadamente
• É possível remarcar com no mínimo 72h de antecedência
• Não remarcamos por motivo de condições climáticas
• Em caso de no-show, não haverá reembolso

⸻

A equipe do Pesque Pague Jango agradece pela preferência e deseja uma estadia incrível!
Qualquer dúvida, estamos à disposição pelo WhatsApp.`;
}

function escaparHtml(texto: string): string {
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function montarHtmlEmailConfirmacaoHospedagem(
    conteudo: HospedagemConfirmacaoConteudo
): string {
    const texto = montarTextoPlanoConfirmacaoHospedagem(conteudo);
    const htmlCorpo = escaparHtml(texto).replace(/\n/g, '<br/>');

    return `
    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.5;">
      ${htmlCorpo}
      <br/>
      <small>Jango Ingressos © ${new Date().getFullYear()}</small>
    </div>
  `;
}

export function montarMensagemWhatsAppConfirmacaoHospedagem(
    conteudo: HospedagemConfirmacaoConteudo
): string {
    return montarTextoPlanoConfirmacaoHospedagem(conteudo);
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
    const origemRow = await ReservaHospedagem.findByPk(idReservaHospedagem, {
        attributes: ['id', 'origemReserva'],
    });
    if (
        !shouldSendAutomaticConfirmation(
            origemRow?.origemReserva ?? null
        )
    ) {
        // Origem externa (HOSPEDIN, providers futuros): não tenta envio
        // e não registra falha de e-mail/WhatsApp.
        return;
    }

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

Importante: você tem 30 minutos para realizar o pagamento. Após esse prazo, a reserva será cancelada automaticamente.

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
      <p><strong>Importante:</strong> você tem 30 minutos para realizar o pagamento. Após esse prazo, a reserva será cancelada automaticamente.</p>
      <p>Para concluir sua reserva e efetuar o pagamento, acesse:</p>
      <p><a href="${conteudo.linkPagamento}" style="color:#0b5fff;">${conteudo.linkPagamento}</a></p>
      <br/>
      <small>Jango Ingressos © ${new Date().getFullYear()}</small>
    </div>
  `;
}

export function montarHtmlEmailExpiracaoHospedagem(
    conteudo: HospedagemConfirmacaoConteudo
): string {
    return `
    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.5;">
      <p>Olá, <strong>${conteudo.nomeCliente}</strong>,</p>
      <p>Informamos que a sua reserva no Pesque Pague Jango foi cancelada porque o pagamento não foi realizado dentro do prazo de 30 minutos.</p>
      <p><strong>Reserva:</strong> ${conteudo.idReserva}</p>
      <p><strong>Check-in:</strong> ${conteudo.dataEntrada}</p>
      <p><strong>Check-out:</strong> ${conteudo.dataSaida}</p>
      <p>Caso ainda tenha interesse em se hospedar conosco, será necessário realizar uma nova reserva, sujeita à disponibilidade.</p>
      <p>Se ainda deseja realizar sua hospedagem, você pode fazer uma nova reserva pelo site <a href="https://www.jangoingressos.com.br" style="color:#0b5fff;">www.jangoingressos.com.br</a>, sujeita à disponibilidade.</p>
      <p>Atenciosamente,<br/>Pesque Pague Jango</p>
      <br/>
      <small>Jango Ingressos © ${new Date().getFullYear()}</small>
    </div>
  `;
}

export function montarMensagemWhatsAppExpiracaoHospedagem(
    conteudo: HospedagemConfirmacaoConteudo
): string {
    return `Olá, ${conteudo.nomeCliente}.

Sua reserva no Pesque Pague Jango foi cancelada porque o pagamento não foi realizado dentro do prazo de 30 minutos.

Se ainda deseja realizar sua hospedagem, você pode fazer uma nova reserva pelo site:

www.jangoingressos.com.br

A nova reserva está sujeita à disponibilidade.

Pesque Pague Jango`;
}

/**
 * E-mail e WhatsApp automáticos quando a reserva expira por falta de pagamento (link externo).
 */
export async function notificarExpiracaoHospedagem(
    idReservaHospedagem: number
): Promise<void> {
    const hospedagem = await ReservaHospedagem.findByPk(idReservaHospedagem, {
        attributes: ['id', 'status', 'idTransacao', 'tokenPagamento'],
    });

    if (!hospedagem) {
        console.error(
            `Reserva ${idReservaHospedagem} não encontrada para notificação de expiração.`
        );
        return;
    }

    if (hospedagem.status !== StatusReservaHospedagem.Expirada) {
        return;
    }

    if (!hospedagem.tokenPagamento || !hospedagem.idTransacao) {
        return;
    }

    const conteudo = await carregarConteudoConfirmacaoHospedagem(
        idReservaHospedagem,
        hospedagem.idTransacao
    );

    if (!conteudo) {
        console.error(
            `Conteúdo não encontrado para expiração da reserva ${idReservaHospedagem}.`
        );
        return;
    }

    try {
        if (conteudo.email) {
            await enviarEmailCliente(
                conteudo.email,
                `Reserva cancelada por falta de pagamento - ${conteudo.nomeEvento}`,
                montarHtmlEmailExpiracaoHospedagem(conteudo)
            );
        }
    } catch (error) {
        console.error(
            `Erro ao enviar e-mail de expiração da reserva ${idReservaHospedagem}:`,
            error
        );
    }

    try {
        if (conteudo.telefone) {
            await enviarMensagemTextoZApi(
                conteudo.telefone,
                montarMensagemWhatsAppExpiracaoHospedagem(conteudo)
            );
        }
    } catch (error) {
        console.error(
            `Erro ao enviar WhatsApp de expiração da reserva ${idReservaHospedagem}:`,
            error
        );
    }
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
