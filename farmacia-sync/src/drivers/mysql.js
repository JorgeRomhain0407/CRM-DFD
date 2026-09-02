'use strict';

/**
 * Driver MySQL / MariaDB.
 * Config (config.db):
 *   tipo: 'mysql'
 *   host / port / user / password / database
 *   tabla / columnas / donde
 */
async function leerProductos(config) {
  const mysql = require('mysql2/promise');
  const c = config || {};

  const conn = await mysql.createConnection({
    host: c.host || 'localhost',
    port: c.port || 3306,
    user: c.user,
    password: c.password,
    database: c.database,
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
    const [rows] = await conn.query(sql);
    return (rows || []).map((f) => ({
      sku: String(f.sku),
      nombre: String(f.nombre || '').trim(),
      descripcion: f.descripcion ? String(f.descripcion) : null,
      precio: Number(f.precio),
      stock: Number.isFinite(Number(f.stock)) ? Math.max(0, Math.floor(Number(f.stock))) : 0,
    }));
  } finally {
    await conn.end();
  }
}

module.exports = { leerProductos };
