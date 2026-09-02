'use strict';

/**
 * Driver PostgreSQL.
 * Config (config.db):
 *   tipo: 'postgres'
 *   host / port / user / password / database
 *   tabla / columnas / donde
 */
async function leerProductos(config) {
  const { Client } = require('pg');
  const c = config || {};

  const client = new Client({
    host: c.host || 'localhost',
    port: c.port || 5432,
    user: c.user,
    password: c.password,
    database: c.database,
  });
  await client.connect();

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
    const res = await client.query(sql);
    return (res.rows || []).map((f) => ({
      sku: String(f.sku),
      nombre: String(f.nombre || '').trim(),
      descripcion: f.descripcion ? String(f.descripcion) : null,
      precio: Number(f.precio),
      stock: Number.isFinite(Number(f.stock)) ? Math.max(0, Math.floor(Number(f.stock))) : 0,
    }));
  } finally {
    await client.end();
  }
}

module.exports = { leerProductos };
