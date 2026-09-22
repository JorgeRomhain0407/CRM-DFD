'use strict';

const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const { validarConfigLotes, camposLotesSql, aFechaCorta, mapearLotes } = require('./lotes-utils');

/**
 * Driver SQLite: lee el catálogo de un archivo .db/.sqlite del TPV.
 *
 * Config (config.db):
 *   tipo: 'sqlite'
 *   file: '/ruta/al/archivo.db'
 *   tabla:  'productos'            (tabla o vista donde están los productos)
 *   columnas:
 *     sku:       'codigo'          (código único de artículo)
 *     nombre:    'nombre'
 *     descripcion: 'descripcion'   (opcional)
 *     precio:    'pvpu'            (precio unitario de venta al público)
 *     stock:     'stock'
 *     marca:     'marca'           (opcional)
 *     fechaVencimiento: 'vencimiento'  (informativa, opcional)
 *   donde:  ''                     (WHERE extra, opcional)
 *
 * leerLotes(config, configLotes, productos): lee lotes por vencimiento (FEFO)
 * desde la misma BD del TPV. Ver lotes-utils.js para el contrato completo.
 */
async function abrirSoloLectura(config) {
  if (!config || !config.file) {
    throw new Error('Falta config.db.file para el driver sqlite.');
  }
  return new Promise((resolve, reject) => {
    const d = new sqlite3.Database(config.file, sqlite3.OPEN_READONLY, (err) =>
      err ? reject(err) : resolve(d)
    );
  });
}

async function leerProductos(config) {
  const db = await abrirSoloLectura(config);
  const all = promisify(db.all.bind(db));
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

  let filas;
  try {
    filas = await all(sql);
  } finally {
    db.close();
  }

  return (filas || []).map((f) => ({
    sku: String(f.sku),
    nombre: String(f.nombre || '').trim(),
    descripcion: f.descripcion ? String(f.descripcion) : null,
    precio: Number(f.precio),
    marca: f.marca ? String(f.marca).trim() : null,
    fechaVencimiento: aFechaCorta(f.fecha_vencimiento),
    stock: Number.isFinite(Number(f.stock)) ? Math.max(0, Math.floor(Number(f.stock))) : 0,
  }));
}

/** Lotes con vencimiento para FEFO. Ver lotes-utils.js. */
async function leerLotes(config, configLotes, productos) {
  const db = await abrirSoloLectura(config);
  const all = promisify(db.all.bind(db));
  const { tabla, donde, columnas: col } = validarConfigLotes(configLotes);
  const sql = `SELECT ${camposLotesSql(col)} FROM ${tabla}` + (donde ? ` WHERE ${donde}` : '');

  let filas;
  try {
    filas = await all(sql);
  } finally {
    db.close();
  }

  return mapearLotes(filas, productos);
}

module.exports = { leerProductos, leerLotes };
