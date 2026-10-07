"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFiltroDataCaixaResumoPdvDia = buildFiltroDataCaixaResumoPdvDia;
exports.listarDiasIsoCaixaResumoPdv = listarDiasIsoCaixaResumoPdv;
exports.sqlResumoCaixaPdvDia = sqlResumoCaixaPdvDia;
exports.agregarResumoCaixaPdvDias = agregarResumoCaixaPdvDias;
/* eslint-disable import/no-anonymous-default-export */
const ConexaoJango_1 = require("../database/ConexaoJango");
const reservaSuitePricing_1 = require("../utils/reservaSuitePricing");
const reservaSuiteUtils_1 = require("../utils/reservaSuiteUtils");
const caixaPdvAberto_1 = require("../utils/caixaPdvAberto");
function assertDataIso(data, nome) {
    const raw = String(data ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw new Error(`${nome} inválida. Use AAAA-MM-DD.`);
    }
    return raw;
}
function pickCampoFirebird(row, ...nomes) {
    for (const nome of nomes) {
        if (row[nome] !== undefined && row[nome] !== null) {
            return row[nome];
        }
        const upper = nome.toUpperCase();
        if (row[upper] !== undefined && row[upper] !== null) {
            return row[upper];
        }
        const lower = nome.toLowerCase();
        if (row[lower] !== undefined && row[lower] !== null) {
            return row[lower];
        }
    }
    return undefined;
}
/** Filtro de um único dia civil (mesma regra da consulta legada de resumo). */
function buildFiltroDataCaixaResumoPdvDia(dataIso) {
    return `CAST(CAIXA.DATA_ABERTURA AS DATE) = DATE '${dataIso}'`;
}
function isoDateAddDays(isoDate, days) {
    const [ano, mes, dia] = isoDate.split("-").map((p) => Number(p));
    const utc = new Date(Date.UTC(ano, mes - 1, dia + days));
    const y = utc.getUTCFullYear();
    const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
    const d = String(utc.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
/** Dias inclusivos [dataInicio, dataFim] em AAAA-MM-DD. */
function listarDiasIsoCaixaResumoPdv(dataInicio, dataFim) {
    const dias = [];
    let cursor = dataInicio;
    while (cursor <= dataFim) {
        dias.push(cursor);
        if (cursor === dataFim) {
            break;
        }
        cursor = isoDateAddDays(cursor, 1);
    }
    return dias;
}
/** SQL diária (FIRST 1) — única forma de leitura no Firebird para resumo. */
function sqlResumoCaixaPdvDia(dataIso) {
    const filtroData = buildFiltroDataCaixaResumoPdvDia(dataIso);
    return `
      SELECT FIRST 1
        CAIXA.ID_CAIXA,
        CAIXA.DATA_ABERTURA,
        CAIXA.DATA_FECHAMENTO,
        CAIXA.STATUS,
        CAIXA.RECEITA_BRUTA,
        CAIXA.SALDO
      FROM CAIXA
      WHERE ${filtroData}
      ORDER BY CAIXA.ID_CAIXA DESC
    `;
}
/** Soma no Node dos resumos diários (dia sem caixa → null na lista). */
function agregarResumoCaixaPdvDias(resumosPorDia) {
    let totalVendido = 0;
    let totalRecebido = 0;
    for (const resumoDia of resumosPorDia) {
        if (!resumoDia) {
            continue;
        }
        totalVendido = (0, reservaSuitePricing_1.roundMoney)(totalVendido + resumoDia.totalVendido);
        totalRecebido = (0, reservaSuitePricing_1.roundMoney)(totalRecebido + resumoDia.totalRecebido);
    }
    return {
        idCaixa: null,
        dataAbertura: null,
        dataFechamento: null,
        status: null,
        totalVendido,
        totalRecebido,
    };
}
async function obterResumoCaixaPdvDia(dataIso) {
    const qry = sqlResumoCaixaPdvDia(dataIso);
    const rows = await (0, ConexaoJango_1.query)(qry);
    const row = rows?.[0];
    if (!row) {
        return null;
    }
    const caixa = mapRowParaCaixaResumoPdv(row);
    if (!caixa) {
        throw new Error(`getCaixaResumo: ID_CAIXA inválido (dia ${dataIso}): ${JSON.stringify(row)}`);
    }
    return caixa;
}
function mapRowParaCaixaResumoPdv(row) {
    const idCaixa = Number(pickCampoFirebird(row, "ID_CAIXA", "id_caixa"));
    if (!Number.isFinite(idCaixa) || idCaixa <= 0) {
        return null;
    }
    return {
        idCaixa,
        dataAbertura: pickCampoFirebird(row, "DATA_ABERTURA", "data_abertura") ?? null,
        dataFechamento: pickCampoFirebird(row, "DATA_FECHAMENTO", "data_fechamento") ?? null,
        status: String(pickCampoFirebird(row, "STATUS", "status") ?? "").trim() || null,
        totalVendido: (0, reservaSuitePricing_1.roundMoney)((0, reservaSuiteUtils_1.toNumber)(pickCampoFirebird(row, "RECEITA_BRUTA", "receita_bruta"))),
        totalRecebido: (0, reservaSuitePricing_1.roundMoney)((0, reservaSuiteUtils_1.toNumber)(pickCampoFirebird(row, "SALDO", "saldo"))),
    };
}
/** Mesmo critério de dia que getCaixa() legado: CURRENT_DATE no Firebird. */
const SQL_FILTRO_DIA_CAIXA_ATUAL = "CAST(CAIXA.DATA_ABERTURA AS DATE) = CURRENT_DATE";
const SQL_CAIXA_ABERTO_HOJE = SQL_FILTRO_DIA_CAIXA_ATUAL + " AND CAIXA.DATA_FECHAMENTO IS NULL";
const BASEAPI = process.env.JANGO_API_BASE || "";
const BASEAPIFotos = process.env.JANGO_API_FOTOS_BASE || "";
const apiFetchGet = async (endpoint, body = "") => {
    //`${BASEAPI+endpoint}/${qs.stringify(body)}`
    let res = await fetch(BASEAPI + endpoint + body);
    // res = res + '["error": "CPF e/ou senha errados!"]';
    const json = await res.json();
    return json;
};
const apiFetchPut = async (endpoint, body) => {
    const res = await fetch(BASEAPI + endpoint, {
        method: "PUT",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Access-Control-Allow-Origin": "*",
            "Accept-Encoding": "identity",
            Accept: "application/json, text/plain; q=0.9, text/html;q=0.8,",
            AcceptCharset: "UTF-8, *;q=0.8",
            Server: "Microsoft-IIS/10.0",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        },
        body: JSON.stringify(body),
    });
    const json = await res.json();
    return json;
};
const apiFetchPost = async (endpoint, body) => {
    const res = await fetch(BASEAPI + endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Access-Control-Allow-Origin": "*",
            "Accept-Encoding": "identity",
            Accept: "application/json, text/plain; q=0.9, text/html;q=0.8,",
            AcceptCharset: "UTF-8, *;q=0.8",
            Server: "Microsoft-IIS/10.0",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        },
        body: JSON.stringify(body).toUpperCase().replace("[", "").replace("]", ""),
    });
    const json = await res.json();
    return json;
};
const PdvApiJango = {
    getCliente: async (cpf_cnpj) => {
        const json = await apiFetchGet("/Cliente", "/cpf_cnpj='" + cpf_cnpj.replace(/\D/g, "") + "'");
        if (json.length === 0) {
            const erro = JSON.parse('{"error": "CPF e/ou senha errados!"}');
            return erro;
        }
        else {
            return json;
        }
    },
    getConta: async (id_cliente, atual = true) => {
        let str = "";
        if (atual) {
            str = "/venda/status = 0 and ";
        }
        else {
            str = "/venda/";
        }
        let json = await apiFetchGet(str + "venda.id_cliente = " + id_cliente + "/id_venda desc");
        return json;
    },
    atualizarCliente: async (cliente) => {
        // let dados = JSON.stringify(cliente);
        // dados = dados.toUpperCase().replace('[','').replace(']','');
        // cliente = JSON.parse(dados);
        delete cliente.ROWID;
        delete cliente.DATA_CRIACAO;
        apiFetchPut("/cliente", cliente);
    },
    inseriIngresso: async (id_ingresso, descricao, id_cliente, id_venda) => {
        const qry = `insert into INGRESSO (ID_INGRESSO, DESCRICAO, ID_CLIENTE, ID_VENDA) values (${id_ingresso}, '${descricao}', ${id_cliente} , ${id_venda})`;
        try {
            await apiFetchGet("/select/" + qry);
        }
        catch (error) {
            console.log("Erro ao inserir ingresso na api: ", error);
        }
        return null;
    },
    /** Contagem read-only de ingressos de hospedagem (Registrar Chegada) por venda PDV. */
    contarIngressosHospedagemPorVenda: async (id_venda) => {
        const idVendaNum = Number(id_venda);
        if (!Number.isFinite(idVendaNum) || idVendaNum <= 0) {
            return { adultos: 0, criancas: 0 };
        }
        const qry = "select DESCRICAO, COUNT(*) as QTD from INGRESSO where ID_VENDA = " +
            idVendaNum +
            " and DESCRICAO in ('Adulto', 'Criança') group by DESCRICAO";
        try {
            const json = await apiFetchGet("/select/" + qry);
            let adultos = 0;
            let criancas = 0;
            if (Array.isArray(json)) {
                for (const row of json) {
                    const desc = String(row.descricao ??
                        row.DESCRICAO ??
                        "");
                    const qtd = Number(row.qtd ??
                        row.QTD ??
                        0);
                    if (desc === "Adulto") {
                        adultos = qtd;
                    }
                    else if (desc === "Criança") {
                        criancas = qtd;
                    }
                }
            }
            return { adultos, criancas };
        }
        catch (error) {
            console.error("Erro ao contar ingressos hospedagem por venda:", error);
            throw error;
        }
    },
    /**
     * Consulta read-only de uma venda PDV por ID_VENDA (checkout automático hospedagem).
     * Não altera getConta/abreConta. Retorna null em falha de comunicação/parse.
     */
    consultarVendaHospedagemPorId: async (id_venda) => {
        const idVendaNum = Number(id_venda);
        if (!Number.isFinite(idVendaNum) || idVendaNum <= 0) {
            return null;
        }
        const qry = "select ID_VENDA, STATUS, DATA_HORA, ID_CLIENTE, TOTAL_VENDA, " +
            "VALOR_RECEBIDO, VALOR_A_RECEBER, SUITE from VENDA where ID_VENDA = " +
            idVendaNum;
        try {
            const json = await apiFetchGet("/select/" + qry);
            if (!Array.isArray(json)) {
                return null;
            }
            return json;
        }
        catch (error) {
            console.error("Erro ao consultar venda hospedagem por ID_VENDA:", error);
            return null;
        }
    },
    abreConta: async (id_cliente, options) => {
        const idClienteNum = Number(id_cliente);
        if (!Number.isFinite(idClienteNum) || idClienteNum <= 0) {
            throw new Error(`id_cliente inválido para abreConta: ${id_cliente}`);
        }
        const suiteHospedagem = options?.suite === true;
        const qry = suiteHospedagem
            ? "insert into VENDA (ID_CLIENTE, TIPO, STATUS, ID_USUARIO, SUITE) " +
                `values (${idClienteNum}, 3, 0, 152, 'SIM') returning ID_VENDA`
            : "insert into VENDA (ID_CLIENTE, TIPO, STATUS, ID_USUARIO) " +
                `values (${idClienteNum}, 3, 0, 152) returning ID_VENDA`;
        const url = BASEAPI + "/select/" + qry;
        let res;
        try {
            res = await fetch(url);
        }
        catch (error) {
            console.error("Erro de rede ao abrir conta na API Jango:", error);
            throw error;
        }
        const text = await res.text();
        if (!res.ok) {
            const msg = `abreConta falhou: HTTP ${res.status} ${res.statusText}. ` +
                `Body: ${text.slice(0, 500)}`;
            console.error(msg);
            throw new Error(msg);
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch (error) {
            const msg = `abreConta: resposta não é JSON válido. Body: ${text.slice(0, 500)}`;
            console.error(msg, error);
            throw new Error(msg);
        }
        const row = Array.isArray(parsed)
            ? parsed[0]
            : parsed && typeof parsed === "object"
                ? parsed
                : null;
        const idVendaRaw = row && typeof row === "object"
            ? row.id_venda ??
                row.ID_VENDA
            : undefined;
        const idVenda = Number(idVendaRaw);
        if (!Number.isFinite(idVenda) || idVenda <= 0) {
            const msg = `abreConta: ID_VENDA ausente ou inválido na resposta: ${text}`;
            console.error(msg);
            throw new Error(msg);
        }
        return idVenda;
    },
    getCaixa: async () => {
        try {
            const str = "/Caixa/";
            const json = await apiFetchGet(str + " CAST(CAIXA.DATA_ABERTURA AS DATE) = CURRENT_DATE");
            return json;
        }
        catch (error) {
            console.error("Erro ao buscar caixa:", error);
            return null; // ou [] ou {} dependendo do esperado
        }
    },
    /**
     * Caixa aberto no dia corrente (PDV): DATA_ABERTURA = CURRENT_DATE e DATA_FECHAMENTO IS NULL.
     * Usado pela hospedagem; não altera getCaixa() legado dos ingressos.
     */
    getCaixaAbertoDoDia: async () => {
        const qry = `
      SELECT FIRST 1
        CAIXA.ID_CAIXA,
        CAIXA.DATA_ABERTURA,
        CAIXA.DATA_FECHAMENTO,
        CAIXA.STATUS,
        CAIXA.RECEITA_BRUTA,
        CAIXA.SALDO
      FROM CAIXA
      WHERE ${SQL_CAIXA_ABERTO_HOJE}
      ORDER BY CAIXA.ID_CAIXA DESC
    `;
        const rows = await (0, ConexaoJango_1.query)(qry);
        const row = rows?.[0];
        if (!row) {
            return null;
        }
        const caixa = mapRowParaCaixaResumoPdv(row);
        if (!caixa || !(0, caixaPdvAberto_1.isCaixaPdvAberto)(caixa)) {
            return null;
        }
        return caixa;
    },
    /** Todos os caixas abertos hoje (detecção de concorrência). */
    listCaixasAbertosDoDia: async () => {
        const qry = `
      SELECT
        CAIXA.ID_CAIXA,
        CAIXA.DATA_ABERTURA,
        CAIXA.DATA_FECHAMENTO,
        CAIXA.STATUS,
        CAIXA.RECEITA_BRUTA,
        CAIXA.SALDO
      FROM CAIXA
      WHERE ${SQL_CAIXA_ABERTO_HOJE}
      ORDER BY CAIXA.ID_CAIXA DESC
    `;
        const rows = await (0, ConexaoJango_1.query)(qry);
        if (!rows?.length) {
            return [];
        }
        const caixas = [];
        for (const row of rows) {
            const caixa = mapRowParaCaixaResumoPdv(row);
            if (caixa && (0, caixaPdvAberto_1.isCaixaPdvAberto)(caixa)) {
                caixas.push(caixa);
            }
        }
        return caixas;
    },
    /**
     * Resumo consolidado do caixa no PDV (tabela CAIXA / Firebird).
     * Mesma regra de identificação do dia que getCaixa(), porém por data informada.
     * RECEITA_BRUTA → total vendido; SALDO → total recebido (sem somar CAIXA_ITEM).
     */
    getCaixaResumo: async (params) => {
        const dataInicio = assertDataIso(params.dataInicio, "Data inicial");
        const dataFim = assertDataIso(params.dataFim ?? params.dataInicio, "Data final");
        if (dataInicio > dataFim) {
            throw new Error("Data inicial não pode ser posterior à data final.");
        }
        try {
            if (dataInicio === dataFim) {
                return await obterResumoCaixaPdvDia(dataInicio);
            }
            const dias = listarDiasIsoCaixaResumoPdv(dataInicio, dataFim);
            const resumosPorDia = [];
            for (const dia of dias) {
                try {
                    resumosPorDia.push(await obterResumoCaixaPdvDia(dia));
                }
                catch (error) {
                    console.error(`Erro ao buscar resumo do caixa no PDV (dia ${dia}):`, error);
                    throw error;
                }
            }
            return agregarResumoCaixaPdvDias(resumosPorDia);
        }
        catch (error) {
            console.error("Erro ao buscar resumo do caixa no PDV:", error);
            throw error;
        }
    },
    inseriCaixaItem: async (id_caixa, valor, id_forma_pagamento, identificadorUnico, 
    /** Quando informado (hospedagem), substitui o padrão "Ingressos …". */
    descricaoCustom) => {
        const formasPermitidasPdv = new Set([38, 32]);
        if (!formasPermitidasPdv.has(id_forma_pagamento)) {
            console.warn(`inseriCaixaItem ignorado: apenas ID_FORMA_PAGAMENTO 38 (dinheiro) ou 32 (antecipado) são permitidos (recebido ${id_forma_pagamento}).`);
            return 0;
        }
        const descricao = (descricaoCustom && String(descricaoCustom).trim()
            ? String(descricaoCustom).trim()
            : `Ingressos ${identificadorUnico}`).replace(/'/g, "''");
        const existentes = await apiFetchGet("/select/" +
            `select ID_CAIXA_ITEM, DESCRICAO from caixa_item where DESCRICAO = '${descricao}'`);
        if (Array.isArray(existentes) && existentes.length > 0) {
            const row = existentes[0];
            const idCaixaItemRaw = row && typeof row === "object"
                ? row
                    .id_caixa_item ??
                    row
                        .ID_CAIXA_ITEM
                : undefined;
            const idCaixaItem = Number(idCaixaItemRaw);
            if (!Number.isFinite(idCaixaItem) || idCaixaItem <= 0) {
                const msg = `inseriCaixaItem: ID_CAIXA_ITEM ausente ou inválido no item existente: ${JSON.stringify(row)}`;
                console.error(msg);
                throw new Error(msg);
            }
            console.log("CaixaItem já existe, não reinsere:", descricao);
            return idCaixaItem;
        }
        const qry = `insert into caixa_item (DESCRICAO, ID_FORMA_PAGAMENTO, ID_CAIXA, ID_USUARIO, TIPO_LANCAMENTO, TIPO_VALOR, VALOR) values ('${descricao}', ${id_forma_pagamento}, ${id_caixa}, 3, 1, 'C', ${valor}) returning ID_CAIXA_ITEM`;
        const url = BASEAPI + "/select/" + qry;
        console.log("Inserindo item no caixa: ", qry);
        let res;
        try {
            res = await fetch(url);
        }
        catch (error) {
            console.error("Erro de rede ao inserir item caixa na API Jango:", error);
            throw error;
        }
        const text = await res.text();
        if (!res.ok) {
            const msg = `inseriCaixaItem falhou: HTTP ${res.status} ${res.statusText}. ` +
                `Body: ${text.slice(0, 500)}`;
            console.error(msg);
            throw new Error(msg);
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch (error) {
            const msg = `inseriCaixaItem: resposta não é JSON válido. Body: ${text.slice(0, 500)}`;
            console.error(msg, error);
            throw new Error(msg);
        }
        const row = Array.isArray(parsed)
            ? parsed[0]
            : parsed && typeof parsed === "object"
                ? parsed
                : null;
        const idCaixaItemRaw = row && typeof row === "object"
            ? row
                .id_caixa_item ??
                row
                    .ID_CAIXA_ITEM
            : undefined;
        const idCaixaItem = Number(idCaixaItemRaw);
        if (!Number.isFinite(idCaixaItem) || idCaixaItem <= 0) {
            const msg = `inseriCaixaItem: ID_CAIXA_ITEM ausente ou inválido na resposta: ${text}`;
            console.error(msg);
            throw new Error(msg);
        }
        return idCaixaItem;
    },
    /**
     * Abertura de caixa via CAIXA_ITEM (TIPO_LANCAMENTO=0).
     * A trigger CAIXA_ITEM_AIO no Firebird cria o registro em CAIXA.
     * Idempotência: o chamador deve usar getCaixaAbertoDoDia() antes de invocar esta função.
     * Não altera inseriCaixaItem — mesma camada /select/ e ID_USUARIO=3.
     */
    inseriCaixaItemAbertura: async () => {
        const descricao = "CAIXA ABERTO PELO JANGO INGRESSOS".replace(/'/g, "''");
        const idFormaPagamentoAbertura = 38;
        const idUsuarioCaixa = 3;
        const qry = `insert into caixa_item (DESCRICAO, ID_FORMA_PAGAMENTO, ID_CAIXA, ID_USUARIO, TIPO_LANCAMENTO, TIPO_VALOR, VALOR) values ('${descricao}', ${idFormaPagamentoAbertura}, NULL, ${idUsuarioCaixa}, 0, 'C', 0) returning ID_CAIXA_ITEM`;
        const url = BASEAPI + "/select/" + qry;
        console.log("Abrindo caixa via caixa_item: ", qry);
        let res;
        try {
            res = await fetch(url);
        }
        catch (error) {
            console.error("Erro de rede ao abrir caixa na API Jango:", error);
            throw error;
        }
        const text = await res.text();
        if (!res.ok) {
            const msg = `inseriCaixaItemAbertura falhou: HTTP ${res.status} ${res.statusText}. ` +
                `Body: ${text.slice(0, 500)}`;
            console.error(msg);
            throw new Error(msg);
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch (error) {
            const msg = `inseriCaixaItemAbertura: resposta não é JSON válido. Body: ${text.slice(0, 500)}`;
            console.error(msg, error);
            throw new Error(msg);
        }
        const row = Array.isArray(parsed)
            ? parsed[0]
            : parsed && typeof parsed === "object"
                ? parsed
                : null;
        const idCaixaItemRaw = row && typeof row === "object"
            ? row
                .id_caixa_item ??
                row
                    .ID_CAIXA_ITEM
            : undefined;
        const idCaixaItem = Number(idCaixaItemRaw);
        if (!Number.isFinite(idCaixaItem) || idCaixaItem <= 0) {
            const msg = `inseriCaixaItemAbertura: ID_CAIXA_ITEM ausente ou inválido na resposta: ${text}`;
            console.error(msg);
            throw new Error(msg);
        }
        return idCaixaItem;
    },
    consultaPedidosPorUsuario: async (dataInicial, dataFinal) => {
        const qry = `
    select 
        id_usuario as id,
        usuario,
        data,
        sum(valorPedido) as valorPedido,
        sum(valorEntregue) as valorEntregue,
        sum(valorPedido + valorEntregue) as total
    from (

        -- CRIADOR
        select 
            u.id_usuario,
            u.usuario,
            sum(vi.valor_total) / 2 as valorPedido,
            0 as valorEntregue,
            cast(p.data_hora as date) as data
        from pedido p
        inner join pedido_item pi 
            on pi.id_pedido = p.id_pedido
        inner join venda_item vi 
            on vi.id_venda = p.id_venda 
           and vi.id_produto = pi.id_produto
        inner join usuario u 
            on u.id_usuario = p.id_usuario
        where p.status = 5
          and p.data_hora between '${dataInicial} 00:00:00' and '${dataFinal} 23:59:59'
        group by u.id_usuario, u.usuario, cast(p.data_hora as date)

        UNION ALL

        -- ENTREGADOR
        select 
            u.id_usuario,
            u.usuario,
            0 as valorPedido,
            sum(vi.valor_total) / 2 as valorEntregue,
            cast(p.data_hora as date) as data
        from pedido p
        inner join pedido_item pi 
            on pi.id_pedido = p.id_pedido
        inner join venda_item vi 
            on vi.id_venda = p.id_venda 
           and vi.id_produto = pi.id_produto
        inner join pedido_status ps 
            on ps.id_pedido = p.id_pedido 
           and ps.status = 5
        inner join usuario u 
            on u.id_usuario = ps.id_usuario
        where p.status = 5
          and p.data_hora between '${dataInicial} 00:00:00' and '${dataFinal} 23:59:59'
        group by u.id_usuario, u.usuario, cast(p.data_hora as date)

    ) t

    group by 
        id_usuario,
        usuario,
        data

    order by 
        usuario,
        data
  `;
        try {
            const rows = await (0, ConexaoJango_1.query)(qry);
            return rows ?? [];
        }
        catch (error) {
            console.log("Erro ao consultar pedidos por usuário: ", error);
            return null;
        }
    },
};
exports.default = () => PdvApiJango;
