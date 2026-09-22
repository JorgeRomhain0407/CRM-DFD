'use strict';

const { validarConfigLotes, camposLotesSql, aFechaCorta, mapearLotes } = require('./lotes-utils');

/**
 * Driver MySQL / MariaDB.
 * Config (config.db):
 *   tipo: 'mysql'
 *   host / port / user / password / database
 *   tabla / columnas / donde
 *
 * leerLotes(config, configLotes, productos): lotes por vencimiento (FEFO)
 * desde la misma BD del TPV. Ver lotes-utils.js.
 */
async function abrirConexion(config) {
  const mysql = require('mysql2/promise');
  const c = config || {};
  return mysql.createConnection({
    host: c.host || 'localhost',
    port: c.port || 3306,
    user: c.user,
    password: c.password,
    database: c.database,
  });
}

async function leerProductos(config) {
  const conn = await abrirConexion(config);
  const col = config.columnas || {};
  const campos = [
    `${col.sku || 'sku'} AS sku`,
    `${col.nombre || 'nombre'} AS nombre`,
    col.descripcion ? `${col.descripcion} AS descripcion` : `NULL AS descripcion`,
    `${col.precio || 'precio'} AS precio`,
    col.precioUsd ? `${col.precioUsd} AS precio_usd` : `NULL AS precio_usd`,
    col.marca ? `${col.marca} AS marca` : `NULL AS marca`,
    col.fechaVencimiento ? `${col.fechaVencimiento} AS fecha_vencimiento` : `NULL AS fecha_vencimiento`,
    `${col.stock || 'stock'} AS stock`,
  ].join(', ');

  const sql = `SELECT ${campos} FROM ${config.tabla || 'productos'}` + (config.donde ? ` WHERE ${config.donde}` : '');

  try {
    const [rows] = await conn.query(sql);
    return (rows || []).map((f) => ({
      sku: String(f.sku),
      nombre: String(f.nombre || '').trim(),
      descripcion: f.descripcion ? String(f.descripcion) : null,
      precio: Number(f.precio),
      marca: f.marca ? String(f.marca).trim() : null,
      fechaVencimiento: aFechaCorta(f.fecha_vencimiento),
      stock: Number.isFinite(Number(f.stock)) ? Math.max(0, Math.floor(Number(f.stock))) : 0,
    }));
  } finally {
    await conn.end();
  }
}

/** Lotes con vencimiento para FEFO. Ver lotes-utils.js. */
async function leerLotes(config, configLotes, productos) {
  const conn = await abrirConexion(config);
  const { tabla, donde, columnas: col } = validarConfigLotes(configLotes);
  const sql = `SELECT ${camposLotesSql(col)} FROM ${tabla}` + (donde ? ` WHERE ${donde}` : '');

  try {
    const [rows] = await conn.query(sql);
    return mapearLotes(rows || [], productos);
  } finally {
    await conn.end();
  }
}

module.exports = { leerProductos, leerLotes };
