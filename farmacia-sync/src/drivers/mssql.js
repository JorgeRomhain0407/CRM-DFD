'use strict';

const { validarConfigLotes, camposLotesSql, aFechaCorta, mapearLotes } = require('./lotes-utils');

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
 *
 * leerLotes(config, configLotes, productos): lotes por vencimiento (FEFO)
 * desde la misma BD del TPV. Ver lotes-utils.js.
 */
async function abrirPool(config) {
  const mssql = require('mssql');
  const c = config || {};
  return mssql.connect({
    server: c.server,
    port: Number(c.port) || 1433,
    user: c.user,
    password: c.password,
    database: c.database,
    options: {
      trustServerCertificate: c.trustServerCertificate != null ? !!c.trustServerCertificate : true,
      enableArithAbort: true,
      encrypt: false,
    },
  });
}

async function leerProductos(config) {
  const pool = await abrirPool(config);
  const col = config.columnas || {};
  const campos = [
    `${col.sku || 'sku'} AS sku`,
    `${col.nombre || 'nombre'} AS nombre`,
    col.descripcion ? `${col.descripcion} AS descripcion` : `NULL AS descripcion`,
    `${col.precio || 'precio'} AS precio`,
    `${col.precioUsd || 'precio_usd'} AS precio_usd`,
    col.marca ? `${col.marca} AS marca` : `NULL AS marca`,
    col.fechaVencimiento ? `${col.fechaVencimiento} AS fecha_vencimiento` : `NULL AS fecha_vencimiento`,
    `${col.stock || 'stock'} AS stock`,
  ].join(', ');

  const sql = `SELECT ${campos} FROM ${config.tabla || 'productos'}` + (config.donde ? ` WHERE ${config.donde}` : '');

  try {
    const result = await pool.request().query(sql);
    return (result.recordset || []).map((f) => ({
      sku: String(f.sku),
      nombre: String(f.nombre || '').trim(),
      descripcion: f.descripcion ? String(f.descripcion) : null,
      precio: Number(f.precio),
      precioUsd: f.precio_usd != null && Number.isFinite(Number(f.precio_usd)) ? Number(f.precio_usd) : null,
      marca: f.marca ? String(f.marca).trim() : null,
      fechaVencimiento: aFechaCorta(f.fecha_vencimiento),
      stock: Number.isFinite(Number(f.stock)) ? Math.max(0, Math.floor(Number(f.stock))) : 0,
    }));
  } finally {
    await pool.close();
  }
}

/** Lotes con vencimiento para FEFO. Ver lotes-utils.js. */
async function leerLotes(config, configLotes, productos) {
  const pool = await abrirPool(config);
  const { tabla, donde, columnas: col } = validarConfigLotes(configLotes);
  const sql = `SELECT ${camposLotesSql(col)} FROM ${tabla}` + (donde ? ` WHERE ${donde}` : '');

  try {
    const result = await pool.request().query(sql);
    return mapearLotes(result.recordset || [], productos);
  } finally {
    await pool.close();
  }
}

module.exports = { leerProductos, leerLotes };
