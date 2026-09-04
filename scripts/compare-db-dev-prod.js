/**
 * Compara estrutura MySQL DEV (localhost) vs PRODUÇÃO (RDS) — somente leitura.
 * Gera: database-diff-dev-producao.sql e database-diff-relatorio.txt
 * Não expõe senhas. Não altera bancos. Não copia dados.
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const ROOT = path.join(__dirname, "..");
const OUT_SQL = path.join(__dirname, "database-diff-dev-producao.sql");
const OUT_REPORT = path.join(__dirname, "database-diff-relatorio.txt");

const FOCUS_TABLES = [
  "ReservaSuite",
  "ReservaHospedagem",
  "PagamentoHospedagem",
  "EventoSuite",
  "EventoSuiteLimpeza",
  "EventoSuiteFoto",
  "HospedagemPagamentoOperacao",
  "ReservaSuiteMovimentacao",
  "ReservaPeriodoMovimentacao",
  "ReservaHospede",
  "HospedinPlaceSuiteMap",
  "IntegrationSyncState",
  "IntegrationEntitySyncEvent",
  "HospedagemRefreshState",
];

function parseEnvFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const active = {};
  const commented = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") && !trimmed.includes("=")) continue;
    const commentedMatch = trimmed.match(/^#\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (commentedMatch) {
      commented[commentedMatch[1]] = commentedMatch[2].trim();
      continue;
    }
    const activeMatch = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (activeMatch) active[activeMatch[1]] = activeMatch[2].trim();
  }
  return { active, commented };
}

function buildConfigs() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(".env não encontrado em ticket-node/");
  }
  const { active, commented } = parseEnvFile(envPath);

  const dev = {
    label: "DEV",
    host: active.DB_HOST || "localhost",
    user: active.DB_USER,
    password: active.DB_PASSWORD,
    database: active.DB_NAME || "ticketJango",
  };

  const prodHost =
    process.env.PROD_DB_HOST ||
    commented.DB_HOST ||
    "jango-ingressos.czgc6wkgq9uj.sa-east-1.rds.amazonaws.com";
  const prod = {
    label: "PROD",
    host: prodHost,
    user: process.env.PROD_DB_USER || active.DB_USER,
    password: process.env.PROD_DB_PASSWORD || commented.DB_PASSWORD || active.DB_PASSWORD,
    database: process.env.PROD_DB_NAME || active.DB_NAME || "ticketJango",
  };

  if (!dev.user || !dev.password) throw new Error("Credenciais DEV incompletas no .env");
  if (!prod.user || !prod.password) throw new Error("Credenciais PROD incompletas (.env ou PROD_DB_*)");

  return { dev, prod };
}

async function connect(cfg) {
  const conn = await mysql.createConnection({
    host: cfg.host,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    multipleStatements: false,
  });
  return conn;
}

async function fetchTables(conn, schema) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, AUTO_INCREMENT
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [schema]
  );
  return rows;
}

async function fetchColumns(conn, schema) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE, DATA_TYPE,
            CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE,
            IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_KEY, COLLATION_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [schema]
  );
  return rows;
}

async function fetchIndexes(conn, schema) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART, INDEX_TYPE
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [schema]
  );
  return rows;
}

async function fetchForeignKeys(conn, schema) {
  const [rows] = await conn.query(
    `SELECT kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME,
            kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
            rc.UPDATE_RULE, rc.DELETE_RULE
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      AND rc.TABLE_NAME = kcu.TABLE_NAME
     WHERE kcu.TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
    [schema]
  );
  return rows;
}

async function fetchViews(conn, schema) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME, VIEW_DEFINITION, CHECK_OPTION, IS_UPDATABLE, DEFINER, SECURITY_TYPE
     FROM information_schema.VIEWS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME`,
    [schema]
  );
  return rows;
}

async function fetchTriggers(conn, schema) {
  const [rows] = await conn.query(
    `SELECT TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_TIMING, ACTION_STATEMENT, DEFINER
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = ?
     ORDER BY TRIGGER_NAME`,
    [schema]
  );
  return rows;
}

async function fetchRoutines(conn, schema) {
  const [rows] = await conn.query(
    `SELECT ROUTINE_NAME, ROUTINE_TYPE, DATA_TYPE, DTD_IDENTIFIER, ROUTINE_DEFINITION, DEFINER, SECURITY_TYPE
     FROM information_schema.ROUTINES
     WHERE ROUTINE_SCHEMA = ?
     ORDER BY ROUTINE_TYPE, ROUTINE_NAME`,
    [schema]
  );
  return rows;
}

async function fetchEvents(conn, schema) {
  const [rows] = await conn.query(
    `SELECT EVENT_NAME, EVENT_DEFINITION, INTERVAL_VALUE, INTERVAL_FIELD, STATUS, DEFINER
     FROM information_schema.EVENTS
     WHERE EVENT_SCHEMA = ?
     ORDER BY EVENT_NAME`,
    [schema]
  );
  return rows;
}

async function showCreateTable(conn, table) {
  const [rows] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
  const row = rows[0];
  const key = Object.keys(row).find((k) => k.toLowerCase().includes("create"));
  return row[key];
}

function normName(name) {
  return String(name || "").toLowerCase();
}

function mapTablesByNorm(tables) {
  const map = new Map();
  for (const t of tables) {
    const key = normName(t.TABLE_NAME);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  return map;
}

function pickCanonicalTable(entries) {
  return entries[0];
}

function groupColumns(columns) {
  const map = new Map();
  for (const c of columns) {
    if (!map.has(c.TABLE_NAME)) map.set(c.TABLE_NAME, new Map());
    map.get(c.TABLE_NAME).set(c.COLUMN_NAME, c);
  }
  return map;
}

function groupIndexes(indexes) {
  const map = new Map();
  for (const idx of indexes) {
    const key = `${idx.TABLE_NAME}::${idx.INDEX_NAME}`;
    if (!map.has(key)) {
      map.set(key, {
        table: idx.TABLE_NAME,
        name: idx.INDEX_NAME,
        nonUnique: idx.NON_UNIQUE,
        type: idx.INDEX_TYPE,
        columns: [],
      });
    }
    map.get(key).columns.push({
      column: idx.COLUMN_NAME,
      subpart: idx.SUB_PART,
      seq: idx.SEQ_IN_INDEX,
    });
  }
  return map;
}

function fkSignature(fk) {
  return `${fk.TABLE_NAME}|${fk.CONSTRAINT_NAME}|${fk.COLUMN_NAME}|${fk.REFERENCED_TABLE_NAME}|${fk.REFERENCED_COLUMN_NAME}|${fk.UPDATE_RULE}|${fk.DELETE_RULE}`;
}

function indexSignature(idx) {
  const cols = idx.columns
    .sort((a, b) => a.seq - b.seq)
    .map((c) => `${c.column}${c.subpart ? `(${c.subpart})` : ""}`)
    .join(",");
  return `${idx.table}|${idx.name}|${idx.nonUnique}|${idx.type}|${cols}`;
}

function columnSignature(c) {
  return JSON.stringify({
    type: c.COLUMN_TYPE,
    nullable: c.IS_NULLABLE,
    default: c.COLUMN_DEFAULT,
    extra: c.EXTRA,
    collation: c.COLLATION_NAME,
    key: c.COLUMN_KEY,
  });
}

function isSafeTypeExpansion(devCol, prodCol) {
  const dt = (devCol.DATA_TYPE || "").toLowerCase();
  const pt = (prodCol.DATA_TYPE || "").toLowerCase();
  if (dt !== pt) return false;
  if (dt === "varchar" || dt === "char") {
    const dlen = devCol.CHARACTER_MAXIMUM_LENGTH || 0;
    const plen = prodCol.CHARACTER_MAXIMUM_LENGTH || 0;
    return dlen > plen;
  }
  if (["int", "bigint", "smallint", "mediumint", "tinyint"].includes(dt)) {
    const order = ["tinyint", "smallint", "mediumint", "int", "bigint"];
    return order.indexOf(dt) > order.indexOf(pt);
  }
  return false;
}

function buildAddColumnSql(table, col) {
  let def = col.COLUMN_TYPE;
  if (col.COLLATION_NAME && col.DATA_TYPE && String(col.DATA_TYPE).match(/char|text|enum|set/i)) {
    // COLUMN_TYPE já inclui charset/collation na maioria dos casos
  }
  let sql = `ALTER TABLE \`${table}\`\n  ADD COLUMN \`${col.COLUMN_NAME}\` ${def}`;
  sql += col.IS_NULLABLE === "YES" ? " NULL" : " NOT NULL";
  if (col.COLUMN_DEFAULT !== null && col.COLUMN_DEFAULT !== undefined) {
    if (col.COLUMN_DEFAULT === "CURRENT_TIMESTAMP" || String(col.COLUMN_DEFAULT).startsWith("CURRENT_TIMESTAMP")) {
      sql += ` DEFAULT ${col.COLUMN_DEFAULT}`;
    } else {
      sql += ` DEFAULT ${mysql.escape(col.COLUMN_DEFAULT)}`;
    }
  }
  if (col.EXTRA) sql += ` ${col.EXTRA}`;
  sql += ";";
  return sql;
}

function buildCreateIndexSql(idx) {
  if (idx.name === "PRIMARY") return null;
  const cols = idx.columns
    .sort((a, b) => a.seq - b.seq)
    .map((c) => `\`${c.column}\`${c.subpart ? `(${c.subpart})` : ""}`)
    .join(", ");
  if (idx.nonUnique === 0) {
    return `ALTER TABLE \`${idx.table}\`\n  ADD UNIQUE INDEX \`${idx.name}\` (${cols});`;
  }
  return `ALTER TABLE \`${idx.table}\`\n  ADD INDEX \`${idx.name}\` (${cols});`;
}

async function loadSchema(conn, schema) {
  const [tables, columns, indexes, fks, views, triggers, routines, events] =
    await Promise.all([
      fetchTables(conn, schema),
      fetchColumns(conn, schema),
      fetchIndexes(conn, schema),
      fetchForeignKeys(conn, schema),
      fetchViews(conn, schema),
      fetchTriggers(conn, schema),
      fetchRoutines(conn, schema),
      fetchEvents(conn, schema),
    ]);
  return {
    tables,
    columns: groupColumns(columns),
    indexes: groupIndexes(indexes),
    fks: fks.map((r) => ({ ...r })),
    views,
    triggers,
    routines,
    events,
    rawColumns: columns,
  };
}

async function main() {
  const { dev, prod } = buildConfigs();
  const report = [];
  const sqlLines = [];
  const manualReview = [];
  const safeChanges = [];

  const pushReport = (line = "") => report.push(line);
  const pushManual = (line) => manualReview.push(line);
  const pushSafe = (line) => safeChanges.push(line);

  sqlLines.push("-- =============================================================================");
  sqlLines.push("-- DIFERENÇAS ESTRUTURAIS: DEV -> PRODUÇÃO");
  sqlLines.push(`-- Gerado em: ${new Date().toISOString()}`);
  sqlLines.push("-- ATENÇÃO: revisar antes de executar em produção.");
  sqlLines.push("-- NÃO inclui DROP, MODIFY arriscado, dados ou AUTO_INCREMENT.");
  sqlLines.push("-- =============================================================================");
  sqlLines.push("");

  let devConn;
  let prodConn;
  try {
    devConn = await connect(dev);
    pushReport(`Conectado DEV: ${dev.host} / ${dev.database}`);
    prodConn = await connect(prod);
    pushReport(`Conectado PROD: ${prod.host} / ${prod.database}`);
  } catch (e) {
    console.error("Falha de conexão:", e.message);
    process.exit(1);
  }

  const devSchema = await loadSchema(devConn, dev.database);
  const prodSchema = await loadSchema(prodConn, prod.database);

  const devTableMap = mapTablesByNorm(devSchema.tables);
  const prodTableMap = mapTablesByNorm(prodSchema.tables);

  const tableNameMap = new Map();
  const allNorms = new Set([...devTableMap.keys(), ...prodTableMap.keys()]);

  for (const norm of allNorms) {
    tableNameMap.set(norm, {
      devName: devTableMap.get(norm)?.[0]?.TABLE_NAME || null,
      prodName: prodTableMap.get(norm)?.[0]?.TABLE_NAME || null,
    });
  }

  const onlyDevTables = [];
  const onlyProdTables = [];
  const commonTables = [];

  for (const [norm, names] of tableNameMap) {
    if (names.devName && !names.prodName) onlyDevTables.push(names.devName);
    else if (!names.devName && names.prodName) onlyProdTables.push(names.prodName);
    else if (names.devName && names.prodName) {
      commonTables.push({
        norm,
        devName: names.devName,
        prodName: names.prodName,
      });
    }
  }
  onlyDevTables.sort();
  onlyProdTables.sort();
  commonTables.sort((a, b) => a.norm.localeCompare(b.norm));

  const devTables = new Set(devSchema.tables.map((t) => t.TABLE_NAME));
  const prodTables = new Set(prodSchema.tables.map((t) => t.TABLE_NAME));

  const colDiffs = [];
  const idxDiffs = [];
  const fkDiffs = [];

  // --- Tabelas somente DEV -> CREATE TABLE ---
  for (const table of onlyDevTables) {
    const focus = FOCUS_TABLES.includes(table) ? " [FOCO HOSPEDAGEM]" : "";
    pushManual(`TABELA SOMENTE DEV: ${table}${focus}`);
    try {
      const createSql = await showCreateTable(devConn, table);
      sqlLines.push(`-- =====================================================`);
      sqlLines.push(`-- DIFERENÇA: tabela ${table} existe no DEV e não na PRODUÇÃO`);
      sqlLines.push(`-- =====================================================`);
      sqlLines.push(`${createSql};`);
      sqlLines.push("");
      pushSafe(`CREATE TABLE ${table}`);
    } catch (e) {
      pushManual(`  ERRO ao obter SHOW CREATE TABLE ${table}: ${e.message}`);
    }
  }

  for (const table of onlyProdTables) {
    const focus = FOCUS_TABLES.includes(table) ? " [FOCO HOSPEDAGEM]" : "";
    pushManual(`PRODUÇÃO POSSUI E DEV NÃO POSSUI — TABELA: ${table}${focus}`);
    pushManual(`AÇÃO: NÃO ALTERAR AUTOMATICAMENTE`);
  }

  // --- Colunas ---
  for (const pair of commonTables) {
    const table = pair.devName;
    const prodTable = pair.prodName;
    const devCols = devSchema.columns.get(table) || new Map();
    const prodCols = prodSchema.columns.get(prodTable) || new Map();

    const prodColsByNorm = new Map();
    for (const [colName, col] of prodCols) {
      prodColsByNorm.set(normName(colName), { name: colName, col });
    }

    for (const [colName, devCol] of devCols) {
      const prodEntry = prodColsByNorm.get(normName(colName));
      if (!prodEntry) {
        colDiffs.push({ table, prodTable, colName, kind: "only_dev", devCol });
        const focus = FOCUS_TABLES.some((f) => normName(f) === pair.norm) ? " [FOCO]" : "";
        sqlLines.push(`-- =====================================================`);
        sqlLines.push(`-- DIFERENÇA: ${prodTable}.${colName} — DEV possui, PROD não${focus}`);
        sqlLines.push(`-- (DEV: ${table}.${colName})`);
        sqlLines.push(`-- =====================================================`);
        const addSql = buildAddColumnSql(prodTable, devCol);
        sqlLines.push(addSql);
        sqlLines.push("");
        pushSafe(`ADD COLUMN ${prodTable}.${colName}`);
      } else {
        const prodCol = prodEntry.col;
        if (columnSignature(devCol) !== columnSignature(prodCol)) {
          colDiffs.push({ table, prodTable, colName, kind: "different", devCol, prodCol });
          const safeExpand = isSafeTypeExpansion(devCol, prodCol);
          const msg = `COLUNA DIFERENTE: ${prodTable}.${colName} | DEV=${devCol.COLUMN_TYPE} NULL=${devCol.IS_NULLABLE} DEF=${devCol.COLUMN_DEFAULT} EXTRA=${devCol.EXTRA} | PROD=${prodCol.COLUMN_TYPE} NULL=${prodCol.IS_NULLABLE} DEF=${prodCol.COLUMN_DEFAULT} EXTRA=${prodCol.EXTRA}`;
          if (safeExpand) {
            pushManual(`${msg} | EXPANSÃO POSSÍVEL — REVISAR MANUALMENTE`);
          } else {
            pushManual(`${msg} | AÇÃO: REVISÃO MANUAL (não gerado automaticamente)`);
          }
        }
      }
    }

    const devColsByNorm = new Map([...devCols].map(([n, c]) => [normName(n), n]));
    for (const [colNorm, prodEntry] of prodColsByNorm) {
      if (!devColsByNorm.has(colNorm)) {
        colDiffs.push({ table, prodTable, colName: prodEntry.name, kind: "only_prod" });
        pushManual(`PRODUÇÃO POSSUI E DEV NÃO POSSUI — COLUNA: ${prodTable}.${prodEntry.name}`);
        pushManual(`AÇÃO: NÃO ALTERAR AUTOMATICAMENTE`);
      }
    }

    const devT = devSchema.tables.find((t) => t.TABLE_NAME === table);
    const prodT = prodSchema.tables.find((t) => t.TABLE_NAME === prodTable);
    if (devT && prodT && devT.AUTO_INCREMENT !== prodT.AUTO_INCREMENT) {
      pushManual(
        `AUTO_INCREMENT DIFERENTE (somente relatório): ${prodTable} DEV=${devT.AUTO_INCREMENT ?? "NULL"} PROD=${prodT.AUTO_INCREMENT ?? "NULL"} — NÃO sincronizar`
      );
    }
  }

  const devIdxList = [...devSchema.indexes.values()].map((idx) => ({
    ...idx,
    normTable: normName(idx.table),
    normName: normName(idx.name),
  }));
  const prodIdxList = [...prodSchema.indexes.values()].map((idx) => ({
    ...idx,
    normTable: normName(idx.table),
    normName: normName(idx.name),
  }));

  const devIdxSigs = new Map();
  for (const idx of devIdxList) {
    devIdxSigs.set(`${idx.normTable}::${indexSignature(idx)}`, idx);
  }
  const prodIdxSigs = new Map();
  for (const idx of prodIdxList) {
    prodIdxSigs.set(`${idx.normTable}::${indexSignature(idx)}`, idx);
  }

  for (const [sig, idx] of devIdxSigs) {
    if (!prodIdxSigs.has(sig)) {
      const pair = tableNameMap.get(idx.normTable);
      const prodTable = pair?.prodName;
      const existsSameName = prodIdxList.some(
        (p) => p.normTable === idx.normTable && p.normName === idx.normName
      );
      idxDiffs.push({ kind: existsSameName ? "different" : "only_dev", idx });
      if (idx.name === "PRIMARY") {
        if (existsSameName) pushManual(`ÍNDICE PRIMARY KEY diferente em ${prodTable || idx.table} — REVISÃO MANUAL`);
        continue;
      }
      if (!existsSameName && prodTable) {
        const createIdx = buildCreateIndexSql({ ...idx, table: prodTable });
        if (createIdx) {
          sqlLines.push(`-- ÍNDICE presente no DEV e ausente na PROD: ${prodTable}.${idx.name}`);
          sqlLines.push(createIdx);
          sqlLines.push("");
          pushSafe(`ADD INDEX ${prodTable}.${idx.name}`);
        }
      } else {
        pushManual(`ÍNDICE MESMO NOME, DEFINIÇÃO DIFERENTE: ${prodTable || idx.table}.${idx.name} — REVISÃO MANUAL`);
      }
    }
  }

  for (const [sig, idx] of prodIdxSigs) {
    if (!devIdxSigs.has(sig)) {
      idxDiffs.push({ kind: "only_prod", idx });
      pushManual(`PRODUÇÃO POSSUI ÍNDICE E DEV NÃO: ${idx.table}.${idx.name} — NÃO ALTERAR AUTOMATICAMENTE`);
    }
  }

  const fkSigNorm = (fk) =>
    `${normName(fk.TABLE_NAME)}|${normName(fk.CONSTRAINT_NAME)}|${normName(fk.COLUMN_NAME)}|${normName(fk.REFERENCED_TABLE_NAME)}|${normName(fk.REFERENCED_COLUMN_NAME)}|${fk.UPDATE_RULE}|${fk.DELETE_RULE}`;

  const devFkSet = new Set(devSchema.fks.map(fkSigNorm));
  const prodFkSet = new Set(prodSchema.fks.map(fkSigNorm));

  for (const fk of devSchema.fks) {
    if (!prodFkSet.has(fkSigNorm(fk))) {
      fkDiffs.push({ kind: "only_dev", fk });
      pushManual(
        `FK SOMENTE DEV: ${fk.TABLE_NAME}.${fk.CONSTRAINT_NAME} (${fk.COLUMN_NAME} -> ${fk.REFERENCED_TABLE_NAME}.${fk.REFERENCED_COLUMN_NAME}) — REVISÃO MANUAL`
      );
    }
  }
  for (const fk of prodSchema.fks) {
    if (!devFkSet.has(fkSigNorm(fk))) {
      fkDiffs.push({ kind: "only_prod", fk });
      pushManual(
        `PRODUÇÃO POSSUI FK E DEV NÃO: ${fk.TABLE_NAME}.${fk.CONSTRAINT_NAME} — NÃO ALTERAR AUTOMATICAMENTE`
      );
    }
  }

  // --- Views, triggers, routines, events (somente relatório) ---
  const devViews = new Set(devSchema.views.map((v) => v.TABLE_NAME));
  const prodViews = new Set(prodSchema.views.map((v) => v.TABLE_NAME));
  const viewDiffCount =
    [...devViews].filter((v) => !prodViews.has(v)).length +
    [...prodViews].filter((v) => !devViews.has(v)).length +
    [...devViews]
      .filter((v) => prodViews.has(v))
      .filter((v) => {
        const d = devSchema.views.find((x) => x.TABLE_NAME === v);
        const p = prodSchema.views.find((x) => x.TABLE_NAME === v);
        return (d?.VIEW_DEFINITION || "") !== (p?.VIEW_DEFINITION || "");
      }).length;

  for (const v of [...devViews].filter((x) => !prodViews.has(x))) {
    pushManual(`VIEW SOMENTE DEV: ${v} — NÃO ALTERAR AUTOMATICAMENTE NESTE PASSO`);
  }
  for (const v of [...prodViews].filter((x) => !devViews.has(x))) {
    pushManual(`VIEW SOMENTE PROD: ${v} — NÃO ALTERAR AUTOMATICAMENTE`);
  }

  const routineSig = (r) => `${r.ROUTINE_TYPE}:${r.ROUTINE_NAME}`;
  const devRoutines = new Set(devSchema.routines.map(routineSig));
  const prodRoutines = new Set(prodSchema.routines.map(routineSig));
  const routineDiffCount =
    [...devRoutines].filter((r) => !prodRoutines.has(r)).length +
    [...prodRoutines].filter((r) => !devRoutines.has(r)).length;

  for (const r of devSchema.routines) {
    const sig = routineSig(r);
    if (!prodRoutines.has(sig)) {
      pushManual(`${r.ROUTINE_TYPE} SOMENTE DEV: ${r.ROUTINE_NAME} — NÃO ALTERAR AUTOMATICAMENTE`);
    }
  }
  for (const r of prodSchema.routines) {
    const sig = routineSig(r);
    if (!devRoutines.has(sig)) {
      pushManual(`${r.ROUTINE_TYPE} SOMENTE PROD: ${r.ROUTINE_NAME} — NÃO ALTERAR AUTOMATICAMENTE`);
    }
  }

  const devTriggers = new Set(devSchema.triggers.map((t) => t.TRIGGER_NAME));
  const prodTriggers = new Set(prodSchema.triggers.map((t) => t.TRIGGER_NAME));
  const triggerDiffCount =
    [...devTriggers].filter((t) => !prodTriggers.has(t)).length +
    [...prodTriggers].filter((t) => !devTriggers.has(t)).length;

  for (const t of [...devTriggers].filter((x) => !prodTriggers.has(x))) {
    pushManual(`TRIGGER SOMENTE DEV: ${t} — NÃO ALTERAR AUTOMATICAMENTE`);
  }
  for (const t of [...prodTriggers].filter((x) => !devTriggers.has(x))) {
    pushManual(`TRIGGER SOMENTE PROD: ${t} — NÃO ALTERAR AUTOMATICAMENTE`);
  }

  const devEvents = new Set(devSchema.events.map((e) => e.EVENT_NAME));
  const prodEvents = new Set(prodSchema.events.map((e) => e.EVENT_NAME));
  const eventDiffCount =
    [...devEvents].filter((e) => !prodEvents.has(e)).length +
    [...prodEvents].filter((e) => !devEvents.has(e)).length;

  for (const e of [...devEvents].filter((x) => !prodEvents.has(x))) {
    pushManual(`EVENT SOMENTE DEV: ${e} — NÃO ALTERAR AUTOMATICAMENTE`);
  }
  for (const e of [...prodEvents].filter((x) => !devEvents.has(x))) {
    pushManual(`EVENT SOMENTE PROD: ${e} — NÃO ALTERAR AUTOMATICAMENTE`);
  }

  const focusFindings = [];
  for (const t of FOCUS_TABLES) {
    const norm = normName(t);
    const names = tableNameMap.get(norm);
    if (names?.devName && !names?.prodName) focusFindings.push(`FOCO: tabela ${t} somente no DEV (${names.devName})`);
    if (!names?.devName && names?.prodName) focusFindings.push(`FOCO: tabela ${t} somente na PROD (${names.prodName})`);
    const cols = colDiffs.filter((c) => normName(c.table) === norm || normName(c.prodTable) === norm);
    if (cols.length) focusFindings.push(`FOCO: ${t} — ${cols.length} diferença(s) de coluna`);
  }

  pushReport("");
  pushReport("NOTA: comparação de tabelas usa normalização case-insensitive (DEV minúsculo vs PROD PascalCase).");

  const totalDiffs =
    onlyDevTables.length +
    onlyProdTables.length +
    colDiffs.length +
    idxDiffs.length +
    fkDiffs.length +
    viewDiffCount +
    triggerDiffCount +
    routineDiffCount +
    eventDiffCount;

  const summary = [];
  summary.push("## RESUMO");
  summary.push("");
  summary.push("Banco DEV:");
  summary.push(dev.database);
  summary.push(`Host DEV: ${dev.host}`);
  summary.push("");
  summary.push("Banco PRODUÇÃO:");
  summary.push(prod.database);
  summary.push(`Host PROD: ${prod.host}`);
  summary.push("");
  summary.push(`Tabelas DEV (físicas): ${devTables.size}`);
  summary.push(`Tabelas PRODUÇÃO (físicas): ${prodTables.size}`);
  summary.push(`Tabelas lógicas DEV (normalizadas): ${devTableMap.size}`);
  summary.push(`Tabelas lógicas PRODUÇÃO (normalizadas): ${prodTableMap.size}`);
  summary.push(`Tabelas somente DEV: ${onlyDevTables.length}`);
  summary.push(`Tabelas somente PRODUÇÃO: ${onlyProdTables.length}`);
  summary.push(`Colunas diferentes: ${colDiffs.length}`);
  summary.push(`Índices diferentes: ${idxDiffs.length}`);
  summary.push(`Foreign Keys diferentes: ${fkDiffs.length}`);
  summary.push(`Views diferentes: ${viewDiffCount}`);
  summary.push(`Triggers diferentes: ${triggerDiffCount}`);
  summary.push(`Procedures/Functions diferentes: ${routineDiffCount}`);
  summary.push(`Events diferentes: ${eventDiffCount}`);
  summary.push(`TOTAL DE DIFERENÇAS (aprox.): ${totalDiffs}`);
  summary.push("");
  summary.push("## FOCO HOSPEDAGEM");
  summary.push(focusFindings.length ? focusFindings.join("\n") : "Nenhuma diferença nas tabelas foco.");
  summary.push("");
  summary.push("## TABELAS SOMENTE DEV");
  summary.push(onlyDevTables.length ? onlyDevTables.join("\n") : "(nenhuma)");
  summary.push("");
  summary.push("## TABELAS SOMENTE PRODUÇÃO");
  summary.push(onlyProdTables.length ? onlyProdTables.join("\n") : "(nenhuma)");
  summary.push("");
  summary.push("## COLUNAS");
  for (const d of colDiffs) {
    if (d.kind === "only_dev") {
      summary.push(`[ADD SEGURO] ${d.table}.${d.colName} — somente DEV`);
    } else if (d.kind === "only_prod") {
      summary.push(`[PROD ONLY] ${d.table}.${d.colName}`);
    } else {
      summary.push(
        `[REVISAR] ${d.table}.${d.colName} DEV=${d.devCol.COLUMN_TYPE} PROD=${d.prodCol.COLUMN_TYPE}`
      );
    }
  }
  summary.push("");
  summary.push("## ALTERAÇÕES SEGURAS GERADAS NO SQL");
  summary.push(safeChanges.length ? safeChanges.join("\n") : "(nenhuma)");
  summary.push("");
  summary.push("## REVISÃO MANUAL");
  summary.push(manualReview.join("\n"));

  const fullReport = [...summary, "", "## LOG DE CONEXÃO", ...report].join("\n");

  fs.writeFileSync(OUT_SQL, sqlLines.join("\n"), "utf8");
  fs.writeFileSync(OUT_REPORT, fullReport, "utf8");

  await devConn.end();
  await prodConn.end();

  console.log("Compare concluído.");
  console.log(`TOTAL_DIFERENCAS=${totalDiffs}`);
  console.log(`TABELAS_SOMENTE_DEV=${onlyDevTables.length}`);
  console.log(`TABELAS_SOMENTE_PROD=${onlyProdTables.length}`);
  console.log(`COLUNAS_DIFERENTES=${colDiffs.length}`);
  console.log(`INDICES_DIFERENTES=${idxDiffs.length}`);
  console.log(`FKS_DIFERENTES=${fkDiffs.length}`);
  console.log(`ALTERACOES_SEGURAS=${safeChanges.length}`);
  console.log(`REVISAO_MANUAL=${manualReview.length}`);
  console.log(`SQL=${OUT_SQL}`);
  console.log(`REPORT=${OUT_REPORT}`);
}

main().catch((e) => {
  console.error("Erro:", e.message);
  process.exit(1);
});
