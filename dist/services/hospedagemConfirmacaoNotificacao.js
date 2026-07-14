"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.carregarConteudoConfirmacaoHospedagem = carregarConteudoConfirmacaoHospedagem;
exports.montarHtmlEmailConfirmacaoHospedagem = montarHtmlEmailConfirmacaoHospedagem;
exports.montarMensagemWhatsAppConfirmacaoHospedagem = montarMensagemWhatsAppConfirmacaoHospedagem;
exports.enviarEmailConfirmacaoHospedagem = enviarEmailConfirmacaoHospedagem;
exports.enviarWhatsAppConfirmacaoHospedagem = enviarWhatsAppConfirmacaoHospedagem;
exports.notificarConfirmacaoHospedagem = notificarConfirmacaoHospedagem;
const date_fns_tz_1 = require("date-fns-tz");
const Evento_1 = require("../models/Evento");
const ReservaHospedagem_1 = require("../models/ReservaHospedagem");
const ReservaSuite_1 = require("../models/ReservaSuite");
const EventoSuite_1 = require("../models/EventoSuite");
const Usuario_1 = require("../models/Usuario");
const Transacao_1 = require("../models/Transacao");
const resend_1 = require("../utils/resend");
const zApiWhatsApp_1 = require("../utils/zApiWhatsApp");
const reservaSuiteUtils_1 = require("../utils/reservaSuiteUtils");
function formatarDataHospedagem(data) {
    return (0, date_fns_tz_1.formatInTimeZone)(data, 'America/Cuiaba', 'dd/MM/yyyy HH:mm');
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
        noites: hospedagem.noites,
        suites: suites.map((suite) => ({
            nome: suite.EventoSuite?.nome ?? `Suíte ${suite.idEventoSuite}`,
            adultos: suite.adultos,
            criancas: suite.criancas,
        })),
        valorTotal: formatarMoeda((0, reservaSuiteUtils_1.toNumber)(hospedagem.valorTotal)),
    };
}
function montarHtmlEmailConfirmacaoHospedagem(conteudo) {
    const suitesHtml = conteudo.suites
        .map((suite) => `
        <li style="margin-bottom: 8px;">
          <strong>${suite.nome}</strong><br/>
          ${suite.adultos} adulto(s), ${suite.criancas} criança(s)
        </li>`)
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
function montarMensagemWhatsAppConfirmacaoHospedagem(conteudo) {
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
