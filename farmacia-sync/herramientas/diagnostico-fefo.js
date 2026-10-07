'use strict';

/*
 * Diagnóstico FEFO: por qué salen 0 marcas y 0 lotes.
 * SOLO LECTURA. Uso (desde C:\farmacia-sync):  node herramientas\diagnostico-fefo.js
 */

const fs = require('fs');
require('dotenv').config({ path: fs.existsSync('.env') ? '.env' : 'farmacia.env' });
const mssql = require('mssql');

const QUERIES = [
  ['DEFINICION de v_catalogo_crm (clave: de donde salen sku y stock)', "EXEC sp_helptext 'dbo.v_catalogo_crm'"],

  ['embudo PRODUCTOLOTE', `SELECT
     (SELECT COUNT(*) FROM dbo.PRODUCTOLOTE) AS pl_total,
     (SELECT COUNT(*) FROM dbo.PRODUCTOLOTE WHERE BACTIVO = 1) AS pl_activos,
     (SELECT COUNT(*) FROM dbo.PRODUCTOLOTE WHERE BACTIVO = 1 AND LTRIM(RTRIM(DFECHAEXP)) <> '') AS pl_con_fecha,
     (SELECT COUNT(*) FROM dbo.PRODUCTOLOTE WHERE BACTIVO = 1 AND LEN(LTRIM(RTRIM(DFECHAEXP))) IN (6,8,10)) AS pl_len_ok,
     (SELECT COUNT(*) FROM dbo.PRODUCTOLOTE WHERE BACTIVO = 1 AND TRY_CONVERT(date, LTRIM(RTRIM(DFECHAEXP)), 23) IS NOT NULL) AS pl_iso_ok`],

  ['embudo INVENTARIO', `SELECT
     (SELECT COUNT(*) FROM dbo.INVENTARIO) AS inv_total,
     (SELECT COUNT(*) FROM dbo.INVENTARIO WHERE BACTIVO = 1) AS inv_activos,
     (SELECT COUNT(*) FROM dbo.INVENTARIO WHERE ICANTIDAD > 0) AS inv_cantidad_pos,
     (SELECT COUNT(*) FROM dbo.INVENTARIO WHERE ICANTIDAD - IRESERVADO > 0) AS inv_disponible_pos,
     (SELECT SUM(ICANTIDAD) FROM dbo.INVENTARIO WHERE BACTIVO = 1) AS inv_sum_cantidad,
     (SELECT SUM(IRESERVADO) FROM dbo.INVENTARIO WHERE BACTIVO = 1) AS inv_sum_reservado`],

  ['inventario que SI tiene stock (muestra)', `SELECT TOP 10 IINVENTARIO, IPRODUCTO, ILOTE, IUBICACION,
      ICANTIDAD, IRESERVADO, BACTIVO
   FROM dbo.INVENTARIO
   WHERE ICANTIDAD > 0
   ORDER BY IINVENTARIO DESC`],

  ['stock agregado por lote (muestra)', `SELECT TOP 10 ILOTE, COUNT(*) AS filas,
      SUM(ICANTIDAD) AS cantidad, SUM(IRESERVADO) AS reservado
   FROM dbo.INVENTARIO
   WHERE BACTIVO = 1
   GROUP BY ILOTE
   ORDER BY SUM(ICANTIDAD) DESC`],

  ['hipotesis A: sku = PRODUCTO.IPRODUCTO', `SELECT TOP 3 c.sku, p.IPRODUCTO, p.VREFERENCIA
   FROM dbo.v_catalogo_crm AS c
   JOIN dbo.PRODUCTO AS p ON p.IPRODUCTO = c.sku`],

  ['hipotesis B: sku = PRODUCTO.VREFERENCIA', `SELECT TOP 3 c.sku, p.IPRODUCTO, p.VREFERENCIA
   FROM dbo.v_catalogo_crm AS c
   JOIN dbo.PRODUCTO AS p ON p.VREFERENCIA = c.sku`],

  ['stock: vista vs ICANTIDADPA vs INVENTARIO (muestra)', `SELECT TOP 5 c.sku, c.stock AS stock_vista,
      p.ICANTIDADPA, p.ICANTIDADPV,
      (SELECT SUM(i.ICANTIDAD - i.IRESERVADO) FROM dbo.INVENTARIO AS i
        WHERE i.BACTIVO = 1 AND i.IPRODUCTO = p.IPRODUCTO) AS inv_disponible
   FROM dbo.v_catalogo_crm AS c
   JOIN dbo.PRODUCTO AS p ON p.IPRODUCTO = c.sku
   ORDER BY c.sku`],

  ['lotes activos con fecha (muestra)', `SELECT TOP 10 ILOTE, IPRODUCTO, VLOTE, DFECHAEXP, BACTIVO
   FROM dbo.PRODUCTOLOTE
   WHERE BACTIVO = 1 AND LTRIM(RTRIM(DFECHAEXP)) <> ''
   ORDER BY ILOTE`],
];

async function main() {
  const pool = await mssql.connect({
    server: process.env.FARMACIA_SYNC_DB_SERVER,
    port: Number(process.env.FARMACIA_SYNC_DB_PORT) || 1433,
    user: process.env.FARMACIA_SYNC_DB_USER,
    password: process.env.FARMACIA_SYNC_DB_PASSWORD,
    database: process.env.FARMACIA_SYNC_DB_DATABASE,
    options: { trustServerCertificate: true, enableArithAbort: true, encrypt: false },
  });

  try {
    for (const [titulo, sql] of QUERIES) {
      console.log(`\n===== ${titulo} =====`);
      try {
        const r = await pool.request().query(sql);
        const filas = r.recordset || [];
        if (!filas.length) {
          console.log('  (sin filas)');
          continue;
        }
        for (const f of filas.slice(0, 60)) {
          const txt = JSON.stringify(f);
          console.log('  ' + (txt.length > 400 ? txt.slice(0, 400) + '…' : txt));
        }
        if (filas.length > 60) console.log(`  … (${filas.length} filas en total)`);
      } catch (err) {
        console.log(`  ✗ ${err.message}`);
      }
    }
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('✗', err.message);
  process.exit(1);
});
