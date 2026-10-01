'use strict';

/*
 * Crea las vistas FEFO en SOINFARMA y muestra la verificación.
 * Equivalente ejecutable de sql/soinfarma-vistas-fefo.sql (bootstrap:
 * si actualizas ese .sql, actualiza también el SQL embebido aquí).
 *
 * Uso (desde C:\farmacia-sync, junto al .env):
 *   node crear-vistas-fefo.js
 */

const fs = require('fs');
require('dotenv').config({ path: fs.existsSync('.env') ? '.env' : 'farmacia.env' });
const mssql = require('mssql');

const SQL_LOTES = `
CREATE VIEW dbo.v_lotes_crm
AS
WITH limpios AS (
    SELECT pl.ILOTE, pl.IPRODUCTO, pl.BACTIVO,
           LTRIM(RTRIM(pl.VLOTE)) AS VLOTE,
           LTRIM(RTRIM(pl.DFECHAEXP)) AS FECHA
    FROM dbo.PRODUCTOLOTE AS pl
),
normalizados AS (
    SELECT ILOTE, IPRODUCTO, BACTIVO, VLOTE,
        CASE
            WHEN FECHA IS NULL OR FECHA = ''
              OR FECHA IN ('5000-01-01','9999-12-31','1900-01-01') THEN NULL
            WHEN LEN(FECHA) = 10
                 THEN CONVERT(varchar(10), TRY_CONVERT(date, FECHA, 23), 23)
            WHEN LEN(FECHA) = 8
                 THEN CONVERT(varchar(10), TRY_CONVERT(date,
                        LEFT(FECHA,4) + '-' + SUBSTRING(FECHA,5,2) + '-' + RIGHT(FECHA,2), 23), 23)
            WHEN LEN(FECHA) = 6
                 THEN CONVERT(varchar(10), TRY_CONVERT(date,
                        LEFT(FECHA,4) + '-' + RIGHT(FECHA,2) + '-01', 23), 23)
            WHEN LEN(FECHA) = 6
                 THEN CONVERT(varchar(10), TRY_CONVERT(date,
                        RIGHT(FECHA,2) + '-' + RIGHT(FECHA,4) + '-01', 23), 23)
            ELSE NULL
        END AS fecha_vencimiento
    FROM limpios
),
stock_lote AS (
    SELECT i.IPRODUCTO, i.ILOTE, SUM(i.ICANTIDAD - i.IRESERVADO) AS stock
    FROM dbo.INVENTARIO AS i
    WHERE i.BACTIVO = 1
    GROUP BY i.IPRODUCTO, i.ILOTE
)
SELECT
    p.VREFERENCIA AS sku,
    CASE WHEN n.VLOTE IS NULL OR n.VLOTE = '' THEN 'S/L' ELSE n.VLOTE END AS lote,
    n.fecha_vencimiento,
    s.stock
FROM normalizados AS n
JOIN dbo.PRODUCTO AS p ON p.IPRODUCTO = n.IPRODUCTO
LEFT JOIN stock_lote AS s ON s.IPRODUCTO = n.IPRODUCTO AND s.ILOTE = n.ILOTE
WHERE n.BACTIVO = 1
  AND n.fecha_vencimiento IS NOT NULL
  AND ISNULL(s.stock, 0) > 0;`;

const SQL_CATALOGO = `
CREATE VIEW dbo.v_catalogo_crm_fefo
AS
SELECT
    c.sku, c.nombre, c.descripcion, c.precio, c.precio_usd, c.stock,
    (SELECT TOP 1 f.VDESCRIPCION
       FROM dbo.PRODUCTO AS p
       JOIN dbo.FABRICANTE AS f ON f.IFABRICANTE = p.IFABRICANTE
      WHERE p.VREFERENCIA = c.sku
      ORDER BY p.IPRODUCTO) AS marca
FROM dbo.v_catalogo_crm AS c;`;

const VERIFICACION = [
  ['marca en el catálogo', `SELECT COUNT(*) AS total,
      SUM(CASE WHEN marca IS NOT NULL THEN 1 ELSE 0 END) AS con_marca,
      ROUND(100.0 * SUM(CASE WHEN marca IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS pct_con_marca
   FROM dbo.v_catalogo_crm_fefo`],
  ['muestra de productos', `SELECT TOP 5 sku, nombre, precio, precio_usd, stock, marca FROM dbo.v_catalogo_crm_fefo ORDER BY sku`],
  ['lotes FEFO', `SELECT COUNT(*) AS lotes, MIN(fecha_vencimiento) AS fefo_mas_proximo FROM dbo.v_lotes_crm`],
  ['muestra de lotes', `SELECT TOP 8 sku, lote, fecha_vencimiento, stock FROM dbo.v_lotes_crm ORDER BY fecha_vencimiento`],
  ['productos con 2+ lotes (FEFO elegirá la fecha más próxima)', `SELECT TOP 8 sku, COUNT(*) AS lotes, MIN(fecha_vencimiento) AS fefo, SUM(stock) AS stock_total
   FROM dbo.v_lotes_crm GROUP BY sku HAVING COUNT(*) > 1 ORDER BY fefo`],
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
    for (const vista of ['v_lotes_crm', 'v_catalogo_crm_fefo']) {
      const existe = await pool.request()
        .input('v', mssql.NVarChar(128), vista)
        .query("SELECT OBJECT_ID('dbo.' + @v, 'V') AS id");
      if (existe.recordset[0].id) {
        await pool.request().query(`DROP VIEW dbo.${vista}`);
        console.log(`· ${vista}: reemplaza vista existente`);
      }
    }

    await pool.request().batch(SQL_LOTES);
    console.log('✔ dbo.v_lotes_crm creada');
    await pool.request().batch(SQL_CATALOGO);
    console.log('✔ dbo.v_catalogo_crm_fefo creada');

    for (const [titulo, sql] of VERIFICACION) {
      console.log(`\n--- ${titulo} ---`);
      const r = await pool.request().query(sql);
      for (const fila of r.recordset || []) console.log('  ' + JSON.stringify(fila));
    }
  } catch (err) {
    console.error('\n✗', err.message);
    if (/permiso|permission|denegado|denied/i.test(err.message)) {
      console.error('\nEl usuario del .env no tiene permiso para crear vistas.');
      console.error('Opción B: en el equipo de la farmacia, SSMS → conectar al servidor');
      console.error('local de SOINFARMA como administrador → abrir y ejecutar');
      console.error('  C:\\Users\\Aleja\\Projects\\CRM-DFD\\farmacia-sync\\sql\\soinfarma-vistas-fefo.sql');
      console.error('(pégame el output de la sección de verificación)');
    }
    process.exitCode = 1;
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('✗', err.message);
  process.exit(1);
});
