'use strict';

const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');

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
 *   donde:  ''                     (WHERE extra, opcional)
 */
async function leerProductos(config) {
  if (!config || !config.file) {
    throw new Error('Falta config.db.file para el driver sqlite.');
  }

  const db = await new Promise((resolve, reject) => {
    const d = new sqlite3.Database(config.file, sqlite3.OPEN_READONLY, (err) =>
      err ? reject(err) : resolve(d)
    );
  });

  const all = promisify(db.all.bind(db));
  const col = config.columnas || {};

  const campos = [
    `${col.sku || 'sku'} AS sku`,
    `${col.nombre || 'nombre'} AS nombre`,
    col.descripcion ? `${col.descripcion} AS descripcion` : `NULL AS descripcion`,
    `${col.precio || 'precio'} AS precio`,
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
    stock: Number.isFinite(Number(f.stock)) ? Math.max(0, Math.floor(Number(f.stock))) : 0,
  }));
}

module.exports = { leerProductos };
