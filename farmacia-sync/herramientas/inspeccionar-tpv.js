'use strict';

/*
 * Inspector del TPV (SOLO LECTURA): lista las columnas de la tabla configurada,
 * busca tablas de lotes/caducidad y detecta columnas de marca/vencimiento.
 * Soporta los 4 drivers: sqlite | mssql | mysql | postgres. No escribe nada.
 *
 * Uso (desde la carpeta con el .env/farmacia.env del servidor farmacia-sync):
 *   node inspeccionar-tpv.js
 */

const fs = require('fs');

const envPath = fs.existsSync('.env') ? '.env' : 'farmacia.env';
require('dotenv').config({ path: envPath });

const TIPO = String(process.env.FARMACIA_SYNC_DB_TIPO || '').toLowerCase();
const TABLA = process.env.FARMACIA_SYNC_DB_TABLA || 'productos';

const CLAVES_MARCA = ['marca', 'fabric', 'laboratorio'];
const CLAVES_VENC = ['venc', 'caduc', 'expir'];
const CLAVES_LOTES = ['lote', 'venc', 'caduc', 'expir', 'batch'];

function esCandidato(nombre, claves) {
  const n = String(nombre).toLowerCase();
  return claves.some((k) => n.includes(k));
}

/* ---------- Adaptadores (uno por motor) ---------- */

async function adaptadorSqlite() {
  const sqlite3 = require('sqlite3').verbose();
  const { promisify } = require('util');
  const file = process.env.FARMACIA_SYNC_DB_FILE;
  if (!file || !fs.existsSync(file)) {
    throw new Error(`FARMACIA_SYNC_DB_FILE no definido o no existe: ${file || '(vacío)'}`);
  }
  const db = await new Promise((resolve, reject) => {
    const d = new sqlite3.Database(file, sqlite3.OPEN_READONLY, (err) => (err ? reject(err) : resolve(d)));
  });
  const all = promisify(db.all.bind(db));
  return {
    encabezado: `sqlite:${file}`,
    cerrar: () => db.close(),
    columnas: async (t) => {
      if (!/^[A-Za-z0-9_]+$/.test(t)) throw new Error(`Nombre de tabla no permitido: "${t}"`);
      const rows = await all(`PRAGMA table_info(${t})`);
      return rows.map((c) => ({ nombre: c.name, tipo: c.type || '?' }));
    },
    tablas: async () =>
      (
        await all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      ).map((r) => r.name),
    filas: async (sql) => all(sql),
    muestra: (select, from, n) => `SELECT ${select} FROM "${from}" LIMIT ${n}`,
    cita: (id) => `"${id}"`,
  };
}

async function adaptadorMssql() {
  const mssql = require('mssql');
  const cfg = {
    server: process.env.FARMACIA_SYNC_DB_SERVER,
    port: Number(process.env.FARMACIA_SYNC_DB_PORT) || 1433,
    user: process.env.FARMACIA_SYNC_DB_USER,
    password: process.env.FARMACIA_SYNC_DB_PASSWORD,
    database: process.env.FARMACIA_SYNC_DB_DATABASE,
    options: { trustServerCertificate: true, enableArithAbort: true, encrypt: false },
  };
  for (const k of ['server', 'database']) {
    if (!cfg[k]) throw new Error(`Falta FARMACIA_SYNC_DB_${k.toUpperCase()} en ${envPath}`);
  }
  const pool = await mssql.connect(cfg);
  const q = async (sql, params = {}) => {
    const req = pool.request();
    for (const [k, v] of Object.entries(params)) req.input(k, mssql.NVarChar(128), v);
    return (await req.query(sql)).recordset || [];
  };
  return {
    encabezado: `mssql ${cfg.server}:${cfg.port} / ${cfg.database}`,
    cerrar: () => pool.close(),
    columnas: (t) =>
      q(
        'SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS ' +
          'WHERE TABLE_NAME = @t ORDER BY ORDINAL_POSITION',
        { t }
      ).then((rows) => rows.map((c) => ({ nombre: c.COLUMN_NAME, tipo: c.DATA_TYPE }))),
    tablas: async () =>
      (
        await q("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME")
      ).map((t) => t.TABLE_NAME),
    filas: (sql) => q(sql),
    muestra: (select, from, n) => `SELECT TOP ${n} ${select} FROM [${from}]`,
    cita: (id) => `[${id}]`,
  };
}

async function adaptadorMysql() {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.FARMACIA_SYNC_DB_SERVER || 'localhost',
    port: Number(process.env.FARMACIA_SYNC_DB_PORT) || 3306,
    user: process.env.FARMACIA_SYNC_DB_USER,
    password: process.env.FARMACIA_SYNC_DB_PASSWORD,
    database: process.env.FARMACIA_SYNC_DB_DATABASE,
  });
  const q = async (sql, params = []) => (await conn.query(sql, params))[0] || [];
  return {
    encabezado: `mysql ${process.env.FARMACIA_SYNC_DB_SERVER}:${conn.connection.config.port} / ${process.env.FARMACIA_SYNC_DB_DATABASE}`,
    cerrar: () => conn.end(),
    columnas: (t) =>
      q(
        'SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS ' +
          'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        [t]
      ).then((rows) => rows.map((c) => ({ nombre: c.COLUMN_NAME, tipo: c.DATA_TYPE }))),
    tablas: async () =>
      (
        await q("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME")
      ).map((t) => t.TABLE_NAME),
    filas: (sql) => q(sql),
    muestra: (select, from, n) => `SELECT ${select} FROM \`${from}\` LIMIT ${n}`,
    cita: (id) => `\`${id}\``,
  };
}

async function adaptadorPostgres() {
  const { Client } = require('pg');
  const client = new Client({
    host: process.env.FARMACIA_SYNC_DB_SERVER || 'localhost',
    port: Number(process.env.FARMACIA_SYNC_DB_PORT) || 5432,
    user: process.env.FARMACIA_SYNC_DB_USER,
    password: process.env.FARMACIA_SYNC_DB_PASSWORD,
    database: process.env.FARMACIA_SYNC_DB_DATABASE,
  });
  await client.connect();
  const q = async (sql, params = []) => (await client.query(sql, params)).rows || [];
  return {
    encabezado: `postgres ${process.env.FARMACIA_SYNC_DB_SERVER}:${client.connectionParameters.port} / ${process.env.FARMACIA_SYNC_DB_DATABASE}`,
    cerrar: () => client.end(),
    columnas: (t) =>
      q(
        'SELECT column_name, data_type FROM information_schema.columns ' +
          'WHERE table_name = $1 ORDER BY ordinal_position',
        [t]
      ).then((rows) => rows.map((c) => ({ nombre: c.column_name, tipo: c.data_type }))),
    tablas: async () =>
      (
        await q("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name")
      ).map((t) => t.table_name),
    filas: (sql) => q(sql),
    muestra: (select, from, n) => `SELECT ${select} FROM "${from}" LIMIT ${n}`,
    cita: (id) => `"${id}"`,
  };
}

/* ---------- Inspección genérica ---------- */

async function inspeccionar(a) {
  console.log(`== Conexión == ${a.encabezado} (env: ${envPath})`);

  const cols = await a.columnas(TABLA);
  if (!cols.length) {
    console.log(`✗ La tabla "${TABLA}" no existe o no expone columnas.`);
  } else {
    console.log(`\n== Columnas de "${TABLA}" (${cols.length}) ==`);
    for (const c of cols) console.log(`  ${c.nombre}  (${c.tipo})`);

    const marcas = cols.filter((c) => esCandidato(c.nombre, CLAVES_MARCA));
    const vencs = cols.filter((c) => esCandidato(c.nombre, CLAVES_VENC));
    console.log('\n== Detección en la tabla de productos ==');
    console.log(`  Marca:       ${marcas.length ? marcas.map((m) => m.nombre).join(', ') : '(ninguna)'}`);
    console.log(`  Vencimiento: ${vencs.length ? vencs.map((m) => m.nombre).join(', ') : '(ninguna)'}`);

    const nombresCols = new Set(cols.map((c) => c.nombre));
    const colSku = process.env.FARMACIA_SYNC_COL_SKU || 'sku';
    const colNombre = process.env.FARMACIA_SYNC_COL_NOMBRE || 'nombre';
    console.log(
      `\n== Mapeo actual == sku=${colSku}${nombresCols.has(colSku) ? '' : ' (NO existe)'} nombre=${colNombre}${nombresCols.has(colNombre) ? '' : ' (NO existe)'}`
    );
    if (nombresCols.has(colSku) && nombresCols.has(colNombre)) {
      const filas = await a.filas(
        a.muestra(`${a.cita(colSku)} AS sku, ${a.cita(colNombre)} AS nombre`, TABLA, 5)
      );
      console.log(`\n== Muestra de "${TABLA}" (5) ==`);
      for (const f of filas) console.log(`  ${f.sku} | ${f.nombre}`);
    }
  }

  const todas = await a.tablas();
  const candidatas = todas.filter((t) => t !== TABLA && esCandidato(t, CLAVES_LOTES)).slice(0, 10);
  console.log(`\n== Tablas candidatas a lotes/caducidad (${candidatas.length}) ==`);
  if (!candidatas.length) console.log('  (ninguna: el TPV no expone lotes en una tabla propia)');
  for (const t of candidatas) {
    const cc = await a.columnas(t);
    console.log(`  • ${t}: ${cc.map((x) => x.nombre).join(', ')}`);
  }
  if (candidatas.length) {
    const t = candidatas[0];
    const filas = await a.filas(a.muestra('*', t, 5));
    console.log(`\n== Muestra de "${t}" (5) ==`);
    for (const f of filas) console.log(`  ${JSON.stringify(f)}`);
  }

  if (TIPO !== 'sqlite') {
    const encontradas = await a.filas(
      "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS " +
        "WHERE COLUMN_NAME LIKE '%venc%' OR COLUMN_NAME LIKE '%caduc%' OR COLUMN_NAME LIKE '%expir%' " +
        "OR COLUMN_NAME LIKE '%marca%' OR COLUMN_NAME LIKE '%fabric%' OR COLUMN_NAME LIKE '%lote%' " +
        "ORDER BY TABLE_NAME, COLUMN_NAME"
    );
    console.log(`\n== Columnas de marca/vencimiento/lote en TODA la BD (${encontradas.length}) ==`);
    for (const c of encontradas.slice(0, 80)) {
      const tn = c.TABLE_NAME || c.table_name;
      const cn = c.COLUMN_NAME || c.column_name;
      const dt = c.DATA_TYPE || c.data_type;
      console.log(`  ${tn}.${cn}  (${dt})`);
    }
    if (encontradas.length > 80) console.log(`  … y ${encontradas.length - 80} más`);
  }

  console.log('\n✔ Inspección terminada. Pega este output completo para mapear los drivers.');
}

async function main() {
  const fabricas = {
    sqlite: adaptadorSqlite,
    mssql: adaptadorMssql,
    sqlserver: adaptadorMssql,
    mysql: adaptadorMysql,
    mariadb: adaptadorMysql,
    postgres: adaptadorPostgres,
    pg: adaptadorPostgres,
  };
  const fabrica = fabricas[TIPO];
  if (!fabrica) {
    console.error(`✗ Inspector no preparado para "${TIPO}" (soporta: sqlite | mssql | mysql | postgres)`);
    process.exit(1);
  }
  let a;
  try {
    a = await fabrica();
  } catch (err) {
    console.error('✗', err.message);
    process.exit(1);
  }
  try {
    await inspeccionar(a);
  } finally {
    await a.cerrar();
  }
}

main().catch((err) => {
  console.error('✗', err.message);
  process.exit(1);
});
