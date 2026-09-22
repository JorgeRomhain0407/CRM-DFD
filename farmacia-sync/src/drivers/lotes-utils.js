'use strict';

/**
 * Utilidades compartidas para la lectura de lotes del TPV (FEFO).
 *
 * Todos los drivers llaman a estas funciones, así que la validación de la
 * config y el mapeo de filas a `{ sku, lote, fecha_vencimiento, stock }`
 * quedan idénticos entre sqlite | mssql | mysql | postgres.
 *
 * Contrato de configLotes (server/index.js, env FARMACIA_SYNC_LOTES_*):
 *   tabla:                  tabla o vista de lotes en la BD del TPV (requerido)
 *   donde:                  WHERE extra SQL (opcional, lo escribe el operador)
 *   columnas.producto_id:   columna con el SKU/código del producto (def: producto_id)
 *   columnas.codigo:        columna con el código del lote (def: lote)
 *   columnas.fecha_vencimiento: columna con la fecha (def: fecha_vencimiento)
 *   columnas.stock:         columna con el stock del lote (def: stock)
 */

const DEFAULTS = {
  producto_id: 'producto_id',
  codigo: 'lote',
  fecha_vencimiento: 'fecha_vencimiento',
  stock: 'stock',
};

function validarConfigLotes(lotes) {
  if (!lotes || typeof lotes !== 'object') {
    throw new Error('Falta la config de lotes (FARMACIA_SYNC_LOTES).');
  }
  const tabla = String(lotes.tabla || '').trim();
  if (!tabla) {
    throw new Error('Falta FARMACIA_SYNC_LOTES_TABLA (tabla de lotes del TPV).');
  }
  const c = lotes.columnas || {};
  const col = {
    producto_id: String(c.producto_id || DEFAULTS.producto_id).trim() || DEFAULTS.producto_id,
    codigo: String(c.codigo || DEFAULTS.codigo).trim() || DEFAULTS.codigo,
    fecha_vencimiento: String(c.fecha_vencimiento || DEFAULTS.fecha_vencimiento).trim() || DEFAULTS.fecha_vencimiento,
    stock: String(c.stock || DEFAULTS.stock).trim() || DEFAULTS.stock,
  };
  return { tabla, donde: lotes.donde ? String(lotes.donde) : '', columnas: col };
}

/** Expresiones SQL con alias fijos: SELECT los usa directamente. */
function camposLotesSql(col) {
  return [
    `${col.producto_id} AS producto_ref`,
    `${col.codigo} AS lote_codigo`,
    `${col.fecha_vencimiento} AS lote_vencimiento`,
    `${col.stock} AS lote_stock`,
  ].join(', ');
}

/** Normaliza cualquier Date/ISO locale a 'YYYY-MM-DD'; null si es inválido/vacío. */
function aFechaCorta(v) {
  if (v == null) return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s || /^(null|0000-00-00)/i.test(s)) return null;
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    // Devuelve tal cual los primeros 10 caracteres normalizados
    const pad = (x) => x.padStart(2, '0');
    return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

/**
 * Convierte filas crudas del TPV en lotes normalizados, resolviendo el SKU
 * contra el catálogo leído con leerProductos (productos = [{ sku, ... }]).
 * Omitidos: filas sin matches de producto o sin fecha parseable (se cuentan,
 * no rompen la sincronización).
 */
function mapearLotes(filas, productos) {
  const indice = new Map();
  for (const p of productos || []) {
    if (p && p.sku) indice.set(String(p.sku).trim().toUpperCase(), p.sku);
  }

  const lotes = [];
  let omitidos_sin_producto = 0;
  let omitidos_sin_fecha = 0;

  for (const f of filas || []) {
    const ref = String(f.lote_producto_ref ?? '').trim();
    const sku = ref ? indice.get(ref.toUpperCase()) || null : null;
    const fecha = aFechaCorta(f.lote_vencimiento);

    if (!sku) {
      omitidos_sin_producto++;
      continue;
    }
    if (!fecha) {
      omitidos_sin_fecha++;
      continue;
    }

    const stock = Number(f.lote_stock);
    lotes.push({
      sku,
      lote: String(f.lote_codigo ?? '').trim(),
      fecha_vencimiento: fecha,
      stock: Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0,
    });
  }

  return { lotes, omitidos_sin_producto, omitidos_sin_fecha };
}

module.exports = { validarConfigLotes, camposLotesSql, aFechaCorta, mapearLotes };
