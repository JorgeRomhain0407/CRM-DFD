'use strict';

/**
 * Driver SQL Server (mssql): lee el catálogo de una BD local del TPV.
 *
 * Config (config.db):
 *   tipo: 'mssql'
 *   server: 'localhost' | 'PC-FARMACIA\SQLEXPRESS'
 *   port: 1433
 *   user / password
 *   database
 *   tabla / columnas / donde   (igual que sqlite)
 *   trustServerCertificate: true   (para instancias locales con cert no verificado)
 */
async function leerProductos(config) {
  const mssql = require('mssql');
  const c = config || {};

  const pool = await mssql.connect({
    server: c.server,
    port: c.port || 1433,
    user: c.user,
    password: c.password,
    database: c.database,
    options: {
      trustServerCertificate: c.trustServerCertificate != null ? !!c.trustServerCertificate : true,
      enableArithAbort: true,
    },
  });

  const col = c.columnas || {};
  const campos = [
    `${col.sku || 'sku'} AS sku`,
    `${col.nombre || 'nombre'} AS nombre`,
    col.descripcion ? `${col.descripcion} AS descripcion` : `NULL AS descripcion`,
    `${col.precio || 'precio'} AS precio`,
    `${col.stock || 'stock'} AS stock`,
  ].join(', ');

  const sql = `SELECT ${campos} FROM ${c.tabla || 'productos'}` + (c.donde ? ` WHERE ${c.donde}` : '');

  try {
    const result = await pool.request().query(sql);
    return (result.recordset || []).map((f) => ({
      sku: String(f.sku),
      nombre: String(f.nombre || '').trim(),
      descripcion: f.descripcion ? String(f.descripcion) : null,
      precio: Number(f.precio),
      stock: Number.isFinite(Number(f.stock)) ? Math.max(0, Math.floor(Number(f.stock))) : 0,
    }));
  } finally {
    await pool.close();
  }
}

module.exports = { leerProductos };
