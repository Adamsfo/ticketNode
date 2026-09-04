"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.montarUrlPublicaReserva = void 0;
exports.carregarConteudoConfirmacaoHospedagem = carregarConteudoConfirmacaoHospedagem;
exports.montarTextoPlanoConfirmacaoHospedagem = montarTextoPlanoConfirmacaoHospedagem;
exports.montarHtmlEmailConfirmacaoHospedagem = montarHtmlEmailConfirmacaoHospedagem;
exports.montarMensagemWhatsAppConfirmacaoHospedagem = montarMensagemWhatsAppConfirmacaoHospedagem;
exports.enviarEmailConfirmacaoHospedagem = enviarEmailConfirmacaoHospedagem;
exports.enviarWhatsAppConfirmacaoHospedagem = enviarWhatsAppConfirmacaoHospedagem;
exports.notificarConfirmacaoHospedagem = notificarConfirmacaoHospedagem;
exports.montarMensagemWhatsAppLinkPagamentoHospedagem = montarMensagemWhatsAppLinkPagamentoHospedagem;
exports.montarHtmlEmailLinkPagamentoHospedagem = montarHtmlEmailLinkPagamentoHospedagem;
exports.montarHtmlEmailExpiracaoHospedagem = montarHtmlEmailExpiracaoHospedagem;
exports.montarMensagemWhatsAppExpiracaoHospedagem = montarMensagemWhatsAppExpiracaoHospedagem;
exports.notificarExpiracaoHospedagem = notificarExpiracaoHospedagem;
exports.notificarLinkPagamentoHospedagem = notificarLinkPagamentoHospedagem;
const date_fns_tz_1 = require("date-fns-tz");
const Evento_1 = require("../models/Evento");
const ReservaHospedagem_1 = require("../models/ReservaHospedagem");
const ReservaSuite_1 = require("../models/ReservaSuite");
const EventoSuite_1 = require("../models/EventoSuite");
const Usuario_1 = require("../models/Usuario");
const Transacao_1 = require("../models/Transacao");
const resend_1 = require("../utils/resend");
const siteUrl_1 = require("../utils/siteUrl");
Object.defineProperty(exports, "montarUrlPublicaReserva", { enumerable: true, get: function () { return siteUrl_1.montarUrlPublicaReserva; } });
const zApiWhatsApp_1 = require("../utils/zApiWhatsApp");
const reservaSuiteUtils_1 = require("../utils/reservaSuiteUtils");
const ReservationNotificationPolicy_1 = require("./ReservationNotificationPolicy");
function formatarDataHospedagem(data) {
    return (0, date_fns_tz_1.formatInTimeZone)(data, 'America/Cuiaba', 'dd/MM/yyyy HH:mm');
}
function formatarDataHospedagemSomenteData(data) {
    return (0, date_fns_tz_1.formatInTimeZone)(data, 'America/Cuiaba', 'dd/MM/yyyy');
}
function formatarMoeda(valor) {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function formatarHospedesWhatsApp(adultos, criancas) {
    const linhas = [];
    if (adultos > 0) {
        linhas.push(`${adultos} ${adultos === 1 ? 'adulto' : 'adultos'}`);
    }
    if (criancas > 0) {
        linhas.push(`${criancas} ${criancas === 1 ? 'criança' : 'crianças'}`);
    }
    return linhas.map((linha) => `  ${linha}`).join('\n');
}
async function carregarConteudoConfirmacaoHospedagem(idReservaHospedagem, idTransacao) {
    const hospedagem = await ReservaHospedagem_1.ReservaHospedagem.findByPk(idReservaHospedagem, {
        include: [
            { model: Usuario_1.Usuario, as: 'Usuario' },
            { model: Evento_1.Evento, as: 'Evento' },
            {
                model: ReservaSuite_1.ReservaSuite,
                as: 'ReservaSuite',
                include: [{ model: EventoSuite_1.EventoSuite, as: 'EventoSuite' }],
            },
        ],
    });
    if (!hospedagem) {
        return null;
    }
    const usuario = hospedagem.Usuario;
    const evento = hospedagem.Evento;
    const suites = hospedagem.ReservaSuite ?? [];
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
        valorTotal: formatarMoeda((0, reservaSuiteUtils_1.toNumber)(hospedagem.valorTotal)),
    };
}
function montarTextoPlanoConfirmacaoHospedagem(conteudo) {
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
function escaparHtml(texto) {
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function montarHtmlEmailConfirmacaoHospedagem(conteudo) {
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
function montarMensagemWhatsAppConfirmacaoHospedagem(conteudo) {
    return montarTextoPlanoConfirmacaoHospedagem(conteudo);
}
async function enviarEmailConfirmacaoHospedagem(conteudo) {
    if (!conteudo.email) {
        throw new Error('E-mail do usuário não informado.');
    }
    console.log('Enviando e-mail');
    await (0, resend_1.enviarEmailCliente)(conteudo.email, `Reserva confirmada - ${conteudo.nomeEvento}`, montarHtmlEmailConfirmacaoHospedagem(conteudo));
    console.log('E-mail enviado');
}
async function enviarWhatsAppConfirmacaoHospedagem(conteudo) {
    if (!conteudo.telefone) {
        throw new Error('Telefone do usuário não informado.');
    }
    console.log('Enviando WhatsApp');
    await (0, zApiWhatsApp_1.enviarMensagemTextoZApi)(conteudo.telefone, montarMensagemWhatsAppConfirmacaoHospedagem(conteudo));
    console.log('WhatsApp enviado');
}
async function registrarFalhaEnvioConfirmacao(conteudo, canal, error) {
    const mensagemErro = error instanceof Error ? error.message : 'Erro desconhecido';
    if (canal === 'e-mail') {
        console.error('Erro ao enviar e-mail:', error);
    }
    else {
        console.error('Erro ao enviar WhatsApp:', error);
    }
    try {
        await Transacao_1.HistoricoTransacao.create({
            idTransacao: conteudo.idTransacao,
            idUsuario: conteudo.idUsuario,
            data: new Date(),
            descricao: `Falha no envio da confirmação de hospedagem por ${canal}: ${mensagemErro}`,
        });
    }
    catch (historicoError) {
        console.error('Erro ao registrar falha de envio no histórico da transação:', historicoError);
    }
}
async function notificarConfirmacaoHospedagem(idReservaHospedagem, idTransacao) {
    const origemRow = await ReservaHospedagem_1.ReservaHospedagem.findByPk(idReservaHospedagem, {
        attributes: ['id', 'origemReserva'],
    });
    if (!(0, ReservationNotificationPolicy_1.shouldSendAutomaticConfirmation)(origemRow?.origemReserva ?? null)) {
        // Origem externa (HOSPEDIN, providers futuros): não tenta envio
        // e não registra falha de e-mail/WhatsApp.
        return;
    }
    const conteudo = await carregarConteudoConfirmacaoHospedagem(idReservaHospedagem, idTransacao);
    if (!conteudo) {
        console.error(`Conteúdo de notificação não encontrado para reserva ${idReservaHospedagem}.`);
        return;
    }
    try {
        await enviarEmailConfirmacaoHospedagem(conteudo);
    }
    catch (error) {
        await registrarFalhaEnvioConfirmacao(conteudo, 'e-mail', error);
    }
    try {
        await enviarWhatsAppConfirmacaoHospedagem(conteudo);
    }
    catch (error) {
        await registrarFalhaEnvioConfirmacao(conteudo, 'WhatsApp', error);
    }
}
function montarMensagemWhatsAppLinkPagamentoHospedagem(conteudo) {
    return `Olá, ${conteudo.nomeCliente}.

Sua reserva foi criada com sucesso.

Importante: você tem 30 minutos para realizar o pagamento. Após esse prazo, a reserva será cancelada automaticamente.

Para concluir sua reserva e efetuar o pagamento, acesse:

${conteudo.linkPagamento}`;
}
function montarHtmlEmailLinkPagamentoHospedagem(conteudo) {
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
function montarHtmlEmailExpiracaoHospedagem(conteudo) {
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
function montarMensagemWhatsAppExpiracaoHospedagem(conteudo) {
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
async function notificarExpiracaoHospedagem(idReservaHospedagem) {
    const hospedagem = await ReservaHospedagem_1.ReservaHospedagem.findByPk(idReservaHospedagem, {
        attributes: ['id', 'status', 'idTransacao', 'tokenPagamento'],
    });
    if (!hospedagem) {
        console.error(`Reserva ${idReservaHospedagem} não encontrada para notificação de expiração.`);
        return;
    }
    if (hospedagem.status !== ReservaHospedagem_1.StatusReservaHospedagem.Expirada) {
        return;
    }
    if (!hospedagem.tokenPagamento || !hospedagem.idTransacao) {
        return;
    }
    const conteudo = await carregarConteudoConfirmacaoHospedagem(idReservaHospedagem, hospedagem.idTransacao);
    if (!conteudo) {
        console.error(`Conteúdo não encontrado para expiração da reserva ${idReservaHospedagem}.`);
        return;
    }
    try {
        if (conteudo.email) {
            await (0, resend_1.enviarEmailCliente)(conteudo.email, `Reserva cancelada por falta de pagamento - ${conteudo.nomeEvento}`, montarHtmlEmailExpiracaoHospedagem(conteudo));
        }
    }
    catch (error) {
        console.error(`Erro ao enviar e-mail de expiração da reserva ${idReservaHospedagem}:`, error);
    }
    try {
        if (conteudo.telefone) {
            await (0, zApiWhatsApp_1.enviarMensagemTextoZApi)(conteudo.telefone, montarMensagemWhatsAppExpiracaoHospedagem(conteudo));
        }
    }
    catch (error) {
        console.error(`Erro ao enviar WhatsApp de expiração da reserva ${idReservaHospedagem}:`, error);
    }
}
/**
 * Envia link de pagamento reutilizando Z-API e Resend já existentes.
 * Não altera o fluxo de confirmação pós-pagamento.
 */
async function notificarLinkPagamentoHospedagem(idReservaHospedagem) {
    const hospedagem = await ReservaHospedagem_1.ReservaHospedagem.findByPk(idReservaHospedagem);
    if (!hospedagem?.tokenPagamento || !hospedagem.idTransacao) {
        throw new Error('Reserva sem token/transação para envio do link.');
    }
    const base = await carregarConteudoConfirmacaoHospedagem(idReservaHospedagem, hospedagem.idTransacao);
    if (!base) {
        throw new Error('Conteúdo da reserva não encontrado para envio do link.');
    }
    const linkPagamento = (0, siteUrl_1.montarUrlPublicaReserva)(hospedagem.tokenPagamento);
    const conteudo = {
        ...base,
        linkPagamento,
    };
    try {
        if (conteudo.email) {
            await (0, resend_1.enviarEmailCliente)(conteudo.email, `Finalize sua reserva - ${conteudo.nomeEvento}`, montarHtmlEmailLinkPagamentoHospedagem(conteudo));
        }
    }
    catch (error) {
        await registrarFalhaEnvioConfirmacao(conteudo, 'e-mail', error);
    }
    try {
        if (conteudo.telefone) {
            await (0, zApiWhatsApp_1.enviarMensagemTextoZApi)(conteudo.telefone, montarMensagemWhatsAppLinkPagamentoHospedagem(conteudo));
        }
    }
    catch (error) {
        await registrarFalhaEnvioConfirmacao(conteudo, 'WhatsApp', error);
    }
    hospedagem.linkPagamentoEnviadoEm = new Date();
    await hospedagem.save();
    try {
        await Transacao_1.HistoricoTransacao.create({
            idTransacao: conteudo.idTransacao,
            idUsuario: conteudo.idUsuario,
            data: new Date(),
            descricao: `Link de pagamento enviado ao cliente: ${linkPagamento}`,
        });
    }
    catch (error) {
        console.error('Erro ao registrar envio do link no histórico:', error);
    }
    return { linkPagamento };
}
