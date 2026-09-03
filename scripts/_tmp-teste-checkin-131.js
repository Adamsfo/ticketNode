require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const apiJango = require("../dist/api/apiJango").default;
const { formatInTimeZone } = require("date-fns-tz");

const TZ = "America/Cuiaba";

function calcSaldo(r, somaPagamentos) {
  const total = Number(r.valor_total) || 0;
  const pagoCol = Number(r.valor_pago) || 0;
  const valorPago = pagoCol > 0 ? pagoCol : somaPagamentos;
  const saldoCol =
    r.saldo_pendente != null ? Number(r.saldo_pendente) : null;
  const saldoCalc = Math.max(0, total - valorPago);
  const colunaConfiavel =
    saldoCol != null &&
    !(pagoCol <= 0 && somaPagamentos > 0) &&
    Math.abs(saldoCol - saldoCalc) <= 0.009;
  return colunaConfiavel ? saldoCol : saldoCalc;
}

(async () => {
  const report = { passo1: {}, passo2: null, passo3: null, passo4: {}, passo5: {}, passo6: {} };

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [rh] = await conn.query(
    `SELECT id, status, checkin, checkout, saldo_pendente, valor_total, valor_pago,
            data_hora_chegada_real, id_usuario_chegada, id_venda_jango,
            data_hora_checkin_real, id_usuario_checkin, id_transacao
     FROM ReservaHospedagem WHERE id = 131`
  );
  const [rs] = await conn.query(
    "SELECT id, status FROM ReservaSuite WHERE id = 131"
  );
  const [pag] = await conn.query(
    "SELECT id, valor, forma_pagamento FROM PagamentoHospedagem WHERE id_reserva_hospedagem = 131"
  );
  const [histBefore] = await conn.query(
    `SELECT ht.id, ht.descricao, ht.data
     FROM HistoricoTransacao ht
     INNER JOIN Transacao t ON t.id = ht.id_transacao
     INNER JOIN ReservaHospedagem rh ON rh.id_transacao = t.id
     WHERE rh.id = 131
     ORDER BY ht.id ASC`
  );

  const r = rh[0];
  const somaPag = pag.reduce((a, p) => a + Number(p.valor || 0), 0);
  const saldo = r ? calcSaldo(r, somaPag) : null;
  const hojeCuiaba = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
  const checkinCuiaba = r?.checkin
    ? formatInTimeZone(new Date(r.checkin), TZ, "yyyy-MM-dd")
    : null;

  let vendaJango = null;
  try {
    const contas = await apiJango().getConta(16, true);
    vendaJango = Array.isArray(contas)
      ? contas.find((c) => Number(c.id_venda) === 54812)
      : null;
  } catch (e) {
    report.passo1.erroJangoLeitura = e.message;
  }

  const checks = {
    reservaExiste: Boolean(r),
    statusConfirmada: r?.status === "Confirmada",
    chegadaPreenchida: Boolean(r?.data_hora_chegada_real),
    idVendaJango54812: Number(r?.id_venda_jango) === 54812,
    saldoOk: saldo != null && saldo <= 0.009,
    checkinPermitidoHoje:
      checkinCuiaba != null && checkinCuiaba <= hojeCuiaba,
    suiteConfirmada: rs[0]?.status === "Confirmada",
    semCheckinPrevio: !r?.data_hora_checkin_real,
    vendaJangoAberta: Boolean(vendaJango && Number(vendaJango.status) === 0),
    idCliente16: vendaJango ? Number(vendaJango.id_cliente) === 16 : false,
  };

  report.passo1 = {
    dados: {
      reserva: r,
      reservaSuite: rs[0] || null,
      saldoPendente: saldo,
      hojeCuiaba,
      checkinCuiaba,
      pagamentos: pag,
      historicoAntes: histBefore,
      vendaJangoAntes: vendaJango
        ? {
            id_venda: vendaJango.id_venda,
            id_cliente: vendaJango.id_cliente,
            status: vendaJango.status,
            status_descricao: vendaJango.status_descricao,
          }
        : null,
    },
    checks,
    prontoParaPost: Object.values(checks).every(Boolean),
  };

  if (!report.passo1.prontoParaPost) {
    await conn.end();
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const snapshotAntes = {
    data_hora_chegada_real: r.data_hora_chegada_real,
    id_usuario_chegada: r.id_usuario_chegada,
    id_venda_jango: r.id_venda_jango,
    checkin: r.checkin,
    checkout: r.checkout,
    saldo_pendente: r.saldo_pendente,
    valor_pago: r.valor_pago,
    qtdPagamentos: pag.length,
  };

  const token = jwt.sign(
    { id: 2, email: "adamsfo20@gmail.com" },
    process.env.JWT_SECRET,
    { expiresIn: "48h" }
  );

  const postRes = await fetch(
    `${process.env.BASE || "http://localhost:9000"}/hospedagem/reservas/131/checkin`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  );

  const postText = await postRes.text();
  let postBody;
  try {
    postBody = JSON.parse(postText);
  } catch {
    postBody = { raw: postText };
  }

  report.passo2 = { executado: true, httpStatus: postRes.status };
  report.passo3 = {
    httpStatus: postRes.status,
    success: postBody.success,
    message: postBody.message,
    id: postBody.data?.id,
    status: postBody.data?.status ?? postBody.data?.statusOriginal,
    dataHoraChegadaReal: postBody.data?.dataHoraChegadaReal,
    idVendaJango: postBody.data?.idVendaJango,
    dataHoraCheckinReal: postBody.data?.dataHoraCheckinReal,
    idUsuarioCheckin: postBody.data?.idUsuarioCheckin,
    suites: postBody.data?.suites?.map((s) => ({
      idReservaSuite: s.idReservaSuite,
      status: s.status,
    })),
  };

  const [rhAfter] = await conn.query(
    `SELECT id, status, checkin, checkout, saldo_pendente, valor_total, valor_pago,
            data_hora_chegada_real, id_usuario_chegada, id_venda_jango,
            data_hora_checkin_real, id_usuario_checkin
     FROM ReservaHospedagem WHERE id = 131`
  );
  const [rsAfter] = await conn.query(
    "SELECT id, status FROM ReservaSuite WHERE id = 131"
  );
  const [pagAfter] = await conn.query(
    "SELECT id, valor, forma_pagamento FROM PagamentoHospedagem WHERE id_reserva_hospedagem = 131"
  );
  const [histAfter] = await conn.query(
    `SELECT ht.id, ht.descricao, ht.data
     FROM HistoricoTransacao ht
     INNER JOIN Transacao t ON t.id = ht.id_transacao
     INNER JOIN ReservaHospedagem rh ON rh.id_transacao = t.id
     WHERE rh.id = 131
     ORDER BY ht.id ASC`
  );

  const ra = rhAfter[0];
  const contasDepois = await apiJango().getConta(16, true);
  const vendasAbertas = Array.isArray(contasDepois) ? contasDepois : [];
  const venda54812Depois = vendasAbertas.find(
    (c) => Number(c.id_venda) === 54812
  );

  report.passo4 = {
    reservaHospedagem: ra,
    reservaSuite: rsAfter[0],
    pagamentos: pagAfter,
    historico: histAfter,
    historicoCheckinCriado: histAfter.some(
      (h) => String(h.descricao) === "Check-in realizado"
    ),
    snapshotAntes,
    chegadaPreservada:
      String(ra.data_hora_chegada_real) ===
      String(snapshotAntes.data_hora_chegada_real),
    idUsuarioChegadaPreservado:
      Number(ra.id_usuario_chegada) ===
      Number(snapshotAntes.id_usuario_chegada),
    idVendaJangoPreservado: Number(ra.id_venda_jango) === 54812,
    checkinCheckoutPlanejadosPreservados:
      String(ra.checkin) === String(snapshotAntes.checkin) &&
      String(ra.checkout) === String(snapshotAntes.checkout),
    financeiroPreservado:
      pagAfter.length === snapshotAntes.qtdPagamentos &&
      String(ra.valor_pago) === String(snapshotAntes.valor_pago) &&
      String(ra.saldo_pendente) === String(snapshotAntes.saldo_pendente),
  };

  report.passo5 = {
    venda54812: venda54812Depois
      ? {
          id_venda: venda54812Depois.id_venda,
          id_cliente: venda54812Depois.id_cliente,
          status: venda54812Depois.status,
          status_descricao: venda54812Depois.status_descricao,
        }
      : null,
    totalContasAbertasCliente16: vendasAbertas.length,
    idsVendasAbertas: vendasAbertas.map((v) => v.id_venda),
    novaVendaCriada: vendasAbertas.some(
      (v) => Number(v.id_venda) !== 54812
    ),
  };

  report.passo6 = {
    postExecutadoUmaVez: true,
    statusHospedada: ra.status === "Hospedada",
    chegadaPreservada: report.passo4.chegadaPreservada,
    idUsuarioChegadaPreservado: report.passo4.idUsuarioChegadaPreservado,
    idVendaJango54812: Number(ra.id_venda_jango) === 54812,
    checkinRealPreenchido: Boolean(ra.data_hora_checkin_real),
    idUsuarioCheckinPreenchido: Number(ra.id_usuario_checkin) > 0,
    suiteHospedada: rsAfter[0]?.status === "Hospedada",
    financeiroInalterado: report.passo4.financeiroPreservado,
    nenhumaNovaVenda:
      !report.passo5.novaVendaCriada && vendasAbertas.length <= 1,
    checkoutNaoExecutado: ra.status !== "CheckOutRealizado",
  };

  await conn.end();
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
