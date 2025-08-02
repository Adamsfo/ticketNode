/* eslint-disable import/no-anonymous-default-export */
// const BASEAPI = 'http://192.168.1.2:80/PDVServer.dll/datasnap/rest/TSM';
// const BASEAPIFotos = 'http://192.168.1.2:80';

const BASEAPI = "http://160.20.20.102:8010/PDVServer.dll/datasnap/rest/TSM";
const BASEAPIFotos = "http://160.20.20.102:8010";

// 192.168.0.2
// 160.20.20.102:8080

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

  abreConta: async (id_cliente: number) => {
    const qry = `insert into VENDA (ID_CLIENTE, TIPO, STATUS, ID_USUARIO) values (${id_cliente}, 3, 0, 152)`;
    try {
      await apiFetchGet("/select/" + qry);
    } catch (error) {
      console.log("Erro ao abrir conta na api: ", error);
    }
    return null;
  },

  getCaixa: async () => {
    let str = "";

    str = "/Caixa/";

    let json = await apiFetchGet(
      str + "CAIXA.ID_STATUS = 0 AND CAST(CAIXA.DATA_ABERTURA AS DATE) = CURRENT_DATE"
    );

    return json;
  },

  inseriCaixaItem: async (id_caixa: string, valor: number) => {
    const qry = `insert into caixa_item (DESCRICAO, ID_FORMA_PAGAMENTO, ID_CAIXA, ID_USUARIO, TIPO_LANCAMENTO, TIPO_VALOR, VALOR) values ('Venda de Ingresso', 23, ${id_caixa}, 3, 3, 'C', ${valor})`;
    try {
      console.log("Inserindo item no caixa: ", qry);
      await apiFetchGet("/select/" + qry);
    } catch (error) {
      console.log("Erro ao inserir item caixa na api: ", error);
    }
    return null;
  },
};

export default () => PdvApiJango;
