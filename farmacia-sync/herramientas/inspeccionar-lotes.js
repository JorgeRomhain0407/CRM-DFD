'use strict';

/*
 * Segunda inspección SOINFARMA (SOLO LECTURA): columnas + muestras de las
 * tablas que alimentan el FEFO (PRODUCTO, PRODUCTOLOTE, INVENTARIO,
 * FABRICANTE y las vistas V_INVENTARIO / V_INVENTARIOPDV).
 * Uso (desde la carpeta con el .env del servidor):
 *   node inspeccionar-lotes.js
 */

const fs = require('fs');

const envPath = fs.existsSync('.env') ? '.env' : 'farmacia.env';
require('dotenv').config({ path: envPath });

const mssql = require('mssql');

const TABLAS = ['PRODUCTO', 'PRODUCTOLOTE', 'INVENTARIO', 'FABRICANTE', 'V_INVENTARIO', 'V_INVENTARIOPDV'];

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
    for (const t of TABLAS) {
      const c = await pool.request()
        .input('t', mssql.NVarChar(128), t)
        .query(
          'SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS ' +
            'WHERE TABLE_NAME = @t ORDER BY ORDINAL_POSITION'
        );
      if (!c.recordset.length) {
        console.log(`\n## ${t}: (no existe)`);
        continue;
      }
      console.log(`\n## ${t} (${c.recordset.length} columnas)`);
      console.log('  ' + c.recordset.map((r) => `${r.COLUMN_NAME}:${r.DATA_TYPE}`).join(', '));
      const s = await pool.request().query(`SELECT TOP 5 * FROM [${t}]`);
      for (const f of s.recordset || []) console.log('  ' + JSON.stringify(f));
    }
    console.log('\n✔ Segunda inspección terminada. Pega el output completo.');
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error('✗', err.message);
  process.exit(1);
});
