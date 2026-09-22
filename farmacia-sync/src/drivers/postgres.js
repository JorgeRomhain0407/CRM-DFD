'use strict';

const { validarConfigLotes, camposLotesSql, aFechaCorta, mapearLotes } = require('./lotes-utils');

/**
 * Driver PostgreSQL.
 * Config (config.db):
 *   tipo: 'postgres'
 *   host / port / user / password / database
 *   tabla / columnas / donde
 *
 * leerLotes(config, configLotes, productos): lotes por vencimiento (FEFO)
 * desde la misma BD del TPV. Ver lotes-utils.js.
 */
async function abrirConexion(config) {
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
  return client;
}

async function leerProductos(config) {
  const client = await abrirConexion(config);
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
    const res = await client.query(sql);
    return (res.rows || []).map((f) => ({
      sku: String(f.sku),
      nombre: String(f.nombre || '').trim(),
      descripcion: f.descripcion ? String(f.descripcion) : null,
      precio: Number(f.precio),
      marca: f.marca ? String(f.marca).trim() : null,
      fechaVencimiento: aFechaCorta(f.fecha_vencimiento),
      stock: Number.isFinite(Number(f.stock)) ? Math.max(0, Math.floor(Number(f.stock))) : 0,
    }));
  } finally {
    await client.end();
  }
}

/** Lotes con vencimiento para FEFO. Ver lotes-utils.js. */
async function leerLotes(config, configLotes, productos) {
  const client = await abrirConexion(config);
  const { tabla, donde, columnas: col } = validarConfigLotes(configLotes);
  const sql = `SELECT ${camposLotesSql(col)} FROM ${tabla}` + (donde ? ` WHERE ${donde}` : '');

  try {
    const res = await client.query(sql);
    return mapearLotes(res.rows || [], productos);
  } finally {
    await client.end();
  }
}

module.exports = { leerProductos, leerLotes };
