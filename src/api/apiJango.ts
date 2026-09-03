/* eslint-disable import/no-anonymous-default-export */
import { query } from "../database/ConexaoJango";

const BASEAPI = process.env.JANGO_API_BASE || "";
const BASEAPIFotos = process.env.JANGO_API_FOTOS_BASE || "";

const apiFetchGet = async (endpoint: string, body: any = "") => {
  //`${BASEAPI+endpoint}/${qs.stringify(body)}`
  let res = await fetch(BASEAPI + endpoint + body);

  // res = res + '["error": "CPF e/ou senha errados!"]';

  const json = await res.json();

  return json;
};

const apiFetchPut = async (endpoint: string, body: any) => {
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

const apiFetchPost = async (endpoint: string, body: any) => {
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
  getCliente: async (cpf_cnpj: string) => {
    const json = await apiFetchGet(
      "/Cliente",
      "/cpf_cnpj='" + cpf_cnpj.replace(/\D/g, "") + "'"
    );

    if (json.length === 0) {
      const erro = JSON.parse('{"error": "CPF e/ou senha errados!"}');
      return erro;
    } else {
      return json;
    }
  },

  getConta: async (id_cliente: string | number, atual = true) => {
    let str = "";

    if (atual) {
      str = "/venda/status = 0 and ";
    } else {
      str = "/venda/";
    }

    let json = await apiFetchGet(
      str + "venda.id_cliente = " + id_cliente + "/id_venda desc"
    );

    return json;
  },

  atualizarCliente: async (cliente: any) => {
    // let dados = JSON.stringify(cliente);
    // dados = dados.toUpperCase().replace('[','').replace(']','');
    // cliente = JSON.parse(dados);
    delete cliente.ROWID;
    delete cliente.DATA_CRIACAO;
    apiFetchPut("/cliente", cliente);
  },

  inseriIngresso: async (id_ingresso: number, descricao: string, id_cliente: number, id_venda: number) => {
    const qry = `insert into INGRESSO (ID_INGRESSO, DESCRICAO, ID_CLIENTE, ID_VENDA) values (${id_ingresso}, '${descricao}', ${id_cliente} , ${id_venda})`;
    try {
      await apiFetchGet("/select/" + qry);
    } catch (error) {
      console.log("Erro ao inserir ingresso na api: ", error);
    }
    return null;
  },

  abreConta: async (id_cliente: number): Promise<number> => {
    const idClienteNum = Number(id_cliente);
    if (!Number.isFinite(idClienteNum) || idClienteNum <= 0) {
      throw new Error(`id_cliente inválido para abreConta: ${id_cliente}`);
    }

    const qry =
      "insert into VENDA (ID_CLIENTE, TIPO, STATUS, ID_USUARIO) " +
      `values (${idClienteNum}, 3, 0, 152) returning ID_VENDA`;
    const url = BASEAPI + "/select/" + qry;

    let res: Response;
    try {
      res = await fetch(url);
    } catch (error) {
      console.error("Erro de rede ao abrir conta na API Jango:", error);
      throw error;
    }

    const text = await res.text();

    if (!res.ok) {
      const msg =
        `abreConta falhou: HTTP ${res.status} ${res.statusText}. ` +
        `Body: ${text.slice(0, 500)}`;
      console.error(msg);
      throw new Error(msg);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      const msg =
        `abreConta: resposta não é JSON válido. Body: ${text.slice(0, 500)}`;
      console.error(msg, error);
      throw new Error(msg);
    }

    const row = Array.isArray(parsed)
      ? parsed[0]
      : parsed && typeof parsed === "object"
        ? parsed
        : null;

    const idVendaRaw =
      row && typeof row === "object"
        ? (row as { id_venda?: unknown; ID_VENDA?: unknown }).id_venda ??
          (row as { id_venda?: unknown; ID_VENDA?: unknown }).ID_VENDA
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
      const json = await apiFetchGet(
        str + " CAST(CAIXA.DATA_ABERTURA AS DATE) = CURRENT_DATE"
      );
      return json;
    } catch (error) {
      console.error("Erro ao buscar caixa:", error);
      return null; // ou [] ou {} dependendo do esperado
    }
  },

  inseriCaixaItem: async (
    id_caixa: string,
    valor: number,
    id_forma_pagamento: number,
    identificadorUnico: string | number,
    /** Quando informado (hospedagem), substitui o padrão "Ingressos …". */
    descricaoCustom?: string | null
  ) => {
    const descricao = (
      descricaoCustom && String(descricaoCustom).trim()
        ? String(descricaoCustom).trim()
        : `Ingressos ${identificadorUnico}`
    ).replace(/'/g, "''");

    try {
      const existentes = await apiFetchGet(
        "/select/" +
          `select DESCRICAO from caixa_item where DESCRICAO = '${descricao}'`
      );

      if (Array.isArray(existentes) && existentes.length > 0) {
        console.log("CaixaItem já existe, não reinsere:", descricao);
        return null;
      }

      const qry = `insert into caixa_item (DESCRICAO, ID_FORMA_PAGAMENTO, ID_CAIXA, ID_USUARIO, TIPO_LANCAMENTO, TIPO_VALOR, VALOR) values ('${descricao}', ${id_forma_pagamento}, ${id_caixa}, 3, 1, 'C', ${valor})`;
      console.log("Inserindo item no caixa: ", qry);
      await apiFetchGet("/select/" + qry);
    } catch (error) {
      console.log("Erro ao inserir item caixa na api: ", error);
    }
    return null;
  },

  consultaPedidosPorUsuario: async (dataInicial: string, dataFinal: string) => {
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
      const rows = await query(qry);
      return rows ?? [];
    } catch (error) {
      console.log("Erro ao consultar pedidos por usuário: ", error);
      return null;
    }
  },
};

export default () => PdvApiJango;
